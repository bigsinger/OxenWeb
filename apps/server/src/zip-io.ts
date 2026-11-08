import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { fromBufferPromise, type ZipFile } from 'yauzl';
import type { Readable } from 'node:stream';
import { ApiError } from './errors.js';

export interface ZipMember { name: string; type:'file'|'directory'; content: Buffer; sha256: string; mode: number; compressedSize: number }
export interface ZipBounds { bytes: number; entries: number; expanded: number; entry: number; ratio: number; timeout: number }
export const importZipBounds: ZipBounds = { bytes: 64*1024*1024, entries: 10_000, expanded: 256*1024*1024, entry: 64*1024*1024, ratio: 1000, timeout: 30_000 };
export const compareZipBounds: ZipBounds = { bytes:25*1024*1024,entries:5000,expanded:100*1024*1024,entry:10*1024*1024,ratio:1000,timeout:20_000 };
export const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
export function zipName(name: string) {
  if (!name || name.length>1024 || /[\\\x00-\x1f\x7f]/.test(name) || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.replace(/\/$/,'').split('/').some(part=>!part||part==='.'||part==='..')) throw new ApiError(422,'ZIP_UNSAFE_PATH','压缩包包含不安全的路径。');
  return name;
}
/** Bounded in-memory ZIP reads; no filesystem extraction or content execution. */
export async function readZipMembers(content:Buffer,bounds:ZipBounds=importZipBounds):Promise<ZipMember[]>{
  if(content.length>bounds.bytes)throw new ApiError(413,'ZIP_SIZE_LIMIT',`ZIP 大小不能超过 ${bounds.bytes/1024/1024} MiB。`);
  let zip:ZipFile|undefined,stream:Readable|undefined,expired=false;
  let rejectTimeout:(error:ApiError)=>void=()=>{};const deadline=new Promise<never>((_,reject)=>{rejectTimeout=reject;});
  const timer=setTimeout(()=>{expired=true;stream?.destroy(new Error('ZIP timeout'));zip?.close();rejectTimeout(new ApiError(408,'ZIP_TIMEOUT','ZIP 读取超时。'));},bounds.timeout);
  try{return await Promise.race([(async()=>{
    zip=await fromBufferPromise(content,{lazyEntries:true,strictFileNames:true,validateEntrySizes:true,autoClose:false});
    if(zip.entryCount>bounds.entries)throw new ApiError(413,'ZIP_COUNT_LIMIT',`ZIP 条目不能超过 ${bounds.entries}。`);
    const result:ZipMember[]=[],seen=new Set<string>();let declared=0,actual=0,count=0;
    for await(const entry of zip.eachEntry()){
      if(expired)throw new ApiError(408,'ZIP_TIMEOUT','ZIP 读取超时。');
      if(++count>bounds.entries)throw new ApiError(413,'ZIP_COUNT_LIMIT','ZIP 条目过多。');
      const name=zipName(entry.fileName),normalized=name.normalize('NFC');
      if(seen.has(normalized))throw new ApiError(422,'ZIP_DUPLICATE_PATH','ZIP 包含重复或歧义路径。');seen.add(normalized);
      const mode=(entry.externalFileAttributes>>>16)&0xffff,type=mode&0xf000;
      if(type!==0&&type!==0x8000&&type!==0x4000)throw new ApiError(422,'ZIP_SPECIAL_FILE','ZIP 不支持符号链接或特殊文件。');
      if(entry.isEncrypted()||(entry.generalPurposeBitFlag&0x40))throw new ApiError(422,'ZIP_ENCRYPTED','不能导入或比较加密 ZIP。');
      if(![0,8].includes(entry.compressionMethod))throw new ApiError(422,'ZIP_COMPRESSION','ZIP 压缩方法不受支持。');
      if(!Number.isSafeInteger(entry.uncompressedSize)||entry.uncompressedSize<0||entry.uncompressedSize>bounds.entry)throw new ApiError(413,'ZIP_ENTRY_LIMIT','ZIP 单条目展开大小超限。');
      declared+=entry.uncompressedSize;
      if(declared>bounds.expanded||entry.uncompressedSize>Math.max(1,entry.compressedSize)*bounds.ratio)throw new ApiError(413,'ZIP_EXPANSION_LIMIT','ZIP 展开总量或压缩比超限。');
      const directory=name.endsWith('/')||type===0x4000||(entry.externalFileAttributes&0x10)!==0;
      if(directory){if(entry.uncompressedSize)throw new ApiError(422,'ZIP_DIRECTORY','目录包含异常数据。');result.push({name,type:'directory',content:Buffer.alloc(0),sha256:sha256(''),mode,compressedSize:entry.compressedSize});continue;}
      stream=await zip.openReadStreamPromise(entry);const chunks:Buffer[]=[];let size=0,crc=0;
      for await(const chunk of stream){const buffer=Buffer.from(chunk);size+=buffer.length;actual+=buffer.length;if(size>bounds.entry||size>entry.uncompressedSize||actual>bounds.expanded||expired)throw new ApiError(413,'ZIP_EXPANSION_LIMIT','ZIP 实际展开大小或读取时间超限。');crc=crc32(buffer,crc);chunks.push(buffer);}
      stream=undefined;
      if(size!==entry.uncompressedSize||crc!==entry.crc32)throw new ApiError(422,'ZIP_INTEGRITY','ZIP 条目长度或 CRC 校验失败。');
      const data=Buffer.concat(chunks);result.push({name,type:'file',content:data,sha256:sha256(data),mode,compressedSize:entry.compressedSize});
    }
    return result;
  })(),deadline]);
  }catch(cause){if(cause instanceof ApiError)throw cause;if(expired)throw new ApiError(408,'ZIP_TIMEOUT','ZIP 读取超时。');throw new ApiError(422,'ZIP_INVALID','ZIP 损坏或格式不受支持。');}
  finally{clearTimeout(timer);stream?.destroy();zip?.close();}
}

/** Deterministic STORE writer with CRC. Names/data only; no executable metadata. */
export function storedZip(files:Array<{name:string;content:Buffer}>,maxBytes=256*1024*1024):Buffer{
  if(files.length>10_000)throw new ApiError(413,'ZIP_OUTPUT_LIMIT','导出文件数量超过 10000。');
  const locals:Buffer[]=[],central:Buffer[]=[],seen=new Set<string>();let offset=0;
  for(const file of [...files].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    const name=Buffer.from(zipName(file.name)),key=file.name.normalize('NFC');if(seen.has(key))throw new ApiError(422,'ZIP_DUPLICATE_PATH','导出包出现重复路径。');seen.add(key);
    const local=Buffer.alloc(30),header=Buffer.alloc(46),crc=crc32(file.content),size=file.content.length;
    if(offset+size+name.length+76>maxBytes)throw new ApiError(413,'ZIP_OUTPUT_LIMIT',`完整 ZIP 超过 ${maxBytes/1024/1024} MiB 上限；已停止构建，未截断内容。`);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(0x21,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(size,18);local.writeUInt32LE(size,22);local.writeUInt16LE(name.length,26);
    header.writeUInt32LE(0x02014b50);header.writeUInt16LE(0x0314,4);header.writeUInt16LE(20,6);header.writeUInt16LE(0x800,8);header.writeUInt16LE(0x21,14);header.writeUInt32LE(crc,16);header.writeUInt32LE(size,20);header.writeUInt32LE(size,24);header.writeUInt16LE(name.length,28);header.writeUInt32LE(((file.name.endsWith('/')?0x41ed:0x81a4)<<16)>>>0,38);header.writeUInt32LE(offset,42);
    locals.push(local,name,file.content);central.push(header,name);offset+=local.length+name.length+size;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  if(offset+directory.length+end.length>maxBytes)throw new ApiError(413,'ZIP_OUTPUT_LIMIT',`完整 ZIP 超过 ${maxBytes/1024/1024} MiB 上限；已停止构建，未截断内容。`);
  return Buffer.concat([...locals,directory,end]);
}
export function utf8Text(content:Buffer,limit=256*1024):string|undefined{if(content.length>limit)return undefined;try{const text=new TextDecoder('utf-8',{fatal:true}).decode(content);return /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)?undefined:text;}catch{return undefined;}}
