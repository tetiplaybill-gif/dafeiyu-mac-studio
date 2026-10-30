'use strict';
// Read the normal webpage's incoming frames. The browser owns connection/auth/ACKs.
// Field numbers are from this repository's protobuf/douyin.proto.
const {gunzipSync}=require('node:zlib');
const MAX_BYTES=4*1024*1024;
function fields(input){
 const data=Buffer.from(input);if(data.length>MAX_BYTES)throw Error('frame_too_large');
 const out=new Map();let i=0,count=0;
 function varint(){let n=0n;for(let b=0;b<10;b++){if(i>=data.length)throw Error('truncated_varint');const v=data[i++];n|=BigInt(v&127)<<BigInt(b*7);if(!(v&128))return n;}throw Error('invalid_varint');}
 while(i<data.length){
  if(++count>50000)throw Error('too_many_fields');
  const tag=varint(),id=Number(tag>>3n),wire=Number(tag&7n);if(id<1)throw Error('invalid_tag');
  let value;
  if(wire===0)value=varint();
  else if(wire===2){const length=Number(varint());if(length>MAX_BYTES||length>data.length-i)throw Error('invalid_length');value=data.subarray(i,i+length);i+=length;}
  else if(wire===1||wire===5){const length=wire===1?8:4;if(i+length>data.length)throw Error('truncated_fixed');i+=length;continue;}
  else throw Error('unsupported_wire');
  if(!out.has(id))out.set(id,[]);out.get(id).push(value);
 }
 return out;
}
const first=(map,id)=>map.get(id)?.[0];
const bytes=(map,id)=>Buffer.isBuffer(first(map,id))?first(map,id):Buffer.alloc(0);
const string=(map,id)=>bytes(map,id).toString('utf8');
const uint=(map,id)=>typeof first(map,id)==='bigint'?first(map,id).toString():'';
function decodeFrame(raw){
 if(!Buffer.isBuffer(raw))return {valid:false,chats:[],members:[],gifts:[]};
 const frame=fields(raw),payload=bytes(frame,8);if(!payload.length)return {valid:false,chats:[],members:[],gifts:[]};
 const encoding=string(frame,6),compressed=encoding==='gzip'||(payload[0]===31&&payload[1]===139);
 const response=fields(compressed?gunzipSync(payload,{maxOutputLength:MAX_BYTES}):payload);
 const chats=[],members=[],gifts=[],methods=[];
 for(const data of response.get(1)||[]){
  if(!Buffer.isBuffer(data))continue;
  const message=fields(data),method=string(message,1);methods.push(method);
  if(method==='WebcastGiftMessage'){
   const gift=fields(bytes(message,2)),common=fields(bytes(gift,1)),user=fields(bytes(gift,7)),item=fields(bytes(gift,15)),recipient=fields(bytes(gift,8));
   const id=uint(common,2)||uint(message,3),room=uint(common,3);
   if(id&&room)gifts.push({id,room,username:string(user,3)||'观众',user_id:uint(user,1),recipient_id:uint(recipient,1),
    gift_id:uint(gift,2)||uint(item,5),gift_name:string(item,16),group_id:uint(gift,11),
    group_count:uint(gift,4),repeat_count:uint(gift,5),combo_count:uint(gift,6),repeat_end:uint(gift,9)==='1',
    combo:uint(item,10)==='1',for_linkmic:uint(item,7)==='1',total_count:uint(gift,29),send_type:uint(gift,17),
    timestamp:Number(uint(common,4))||Number(uint(gift,33))||0,frame_timestamp:Number(uint(response,4))||0});
   continue;
  }
  if(method==='WebcastMemberMessage'){
   const member=fields(bytes(message,2)),common=fields(bytes(member,1)),user=fields(bytes(member,2));
   const id=uint(common,2)||uint(message,3),room=uint(common,3);
   if(id&&room)members.push({id,room,username:string(user,3),user_id:uint(user,1)||uint(member,12),
    timestamp:Number(uint(common,4))||0,frame_timestamp:Number(uint(response,4))||0,
    action:uint(member,10)||'0',enter_type:uint(member,9)||'0'});
   continue;
  }
  if(method!=='WebcastChatMessage')continue;
  const chat=fields(bytes(message,2)),common=fields(bytes(chat,1)),user=fields(bytes(chat,2));
  const content=string(chat,3),id=uint(common,2)||uint(message,3),room=uint(common,3);
  if(!content||!id||!room)continue;
  chats.push({id,room,username:string(user,3)||'观众',user_id:uint(user,1),content,
              timestamp:Number(uint(common,4))||Number(uint(chat,15))||0,
              frame_timestamp:Number(uint(response,4))||0,visible_to_sender:uint(chat,4)==='1'});
 }
 return {valid:true,chats,members,gifts,methods,serverTime:Number(uint(response,4))||0};
}
module.exports={fields,decodeFrame};
