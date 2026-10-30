// Native macOS WebSocket transport. Key arrives on stdin, never in argv/logs/files.
import Foundation

enum VoiceFailure: Error { case invalid, tooLarge, provider, incomplete }

@main struct VoiceBridge {
    static func send(_ object: [String: Any], to socket: URLSessionWebSocketTask) async throws {
        let data = try JSONSerialization.data(withJSONObject: object)
        try await socket.send(.string(String(decoding: data, as: UTF8.self)))
    }

    static func generate(_ config: [String: Any]) async throws -> [String: Any] {
        guard let key = config["key"] as? String, key.count >= 20,
              let session = config["session"] as? [String: Any],
              let response = config["response"] as? [String: Any] else { throw VoiceFailure.invalid }
        var request = URLRequest(url: URL(string: "wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini")!)
        request.timeoutInterval = 45
        request.setValue("Bearer " + key, forHTTPHeaderField: "Authorization")
        let connection = URLSession(configuration: .ephemeral)
        defer { connection.invalidateAndCancel() }
        let socket = connection.webSocketTask(with: request)
        socket.maximumMessageSize = 2_000_000
        socket.resume()
        defer { socket.cancel(with: .normalClosure, reason: nil) }
        var pcm = Data()
        var transcript = ""
        var configured = false
        var requested = false
        while true {
            let message = try await socket.receive()
            let data: Data
            switch message {
            case .string(let value): data = Data(value.utf8)
            case .data(let value): data = value
            @unknown default: throw VoiceFailure.invalid
            }
            guard let event = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let type = event["type"] as? String else { throw VoiceFailure.invalid }
            switch type {
            case "session.created":
                guard !configured else { throw VoiceFailure.invalid }
                configured = true
                try await send(["type": "session.update", "session": session], to: socket)
            case "session.updated":
                if !requested {
                    requested = true
                    try await send(["type": "response.create", "response": response], to: socket)
                }
            case "response.output_audio.delta":
                guard let value = event["delta"] as? String,
                      let chunk = Data(base64Encoded: value) else { throw VoiceFailure.invalid }
                pcm.append(chunk)
                if pcm.count > 5_760_000 { throw VoiceFailure.tooLarge } // 120 s PCM maximum
            case "response.output_audio_transcript.delta":
                transcript += event["delta"] as? String ?? ""
                if transcript.count > 6000 { throw VoiceFailure.tooLarge }
            case "response.output_audio_transcript.done":
                transcript = event["transcript"] as? String ?? transcript
            case "response.done":
                guard let result = event["response"] as? [String: Any],
                      result["status"] as? String == "completed", !pcm.isEmpty,
                      pcm.count % 2 == 0, !transcript.isEmpty else { throw VoiceFailure.incomplete }
                return ["pcm": pcm.base64EncodedString(), "transcript": transcript,
                        "usage": result["usage"] as? [String: Any] ?? [:]]
            case "error": throw VoiceFailure.provider
            default: break
            }
        }
    }

    static func main() async {
        do {
            let input = FileHandle.standardInput.readDataToEndOfFile()
            guard input.count < 20000,
                  let config = try JSONSerialization.jsonObject(with: input) as? [String: Any]
                  else { throw VoiceFailure.invalid }
            let result = try await generate(config)
            FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result))
        } catch {
            // Never echo provider bodies, URLRequests, headers or input to the caller.
            FileHandle.standardError.write(Data("Natural voice request failed.\n".utf8))
            exit(1)
        }
    }
}
