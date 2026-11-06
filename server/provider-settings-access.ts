// 生成设置只接受真实回环或私有网络来源，Host 必须对应当前服务的本机接口与端口。
// 开发代理在转发前复用此边界；不通过转发头推断来源或信任任意私有 Host。
import {BlockList,isIP} from 'node:net';
import {networkInterfaces} from 'node:os';
import {loopbackAddress} from '../lib/provider-settings.ts';

const privateNetworks=new BlockList();
for(const [address,prefix] of [['10.0.0.0',8],['172.16.0.0',12],['192.168.0.0',16],['169.254.0.0',16]] as const)privateNetworks.addSubnet(address,prefix,'ipv4');
privateNetworks.addSubnet('fc00::',7,'ipv6');privateNetworks.addSubnet('fe80::',10,'ipv6');
export function privateNetworkAddress(address:string|undefined){
 if(!address)return false;
 const ip=address.split('%')[0],family=isIP(ip);
 return !!family&&privateNetworks.check(ip,family===6?'ipv6':'ipv4');
}
export function providerSettingsNetworkAccess(ports:number[],interfaces=networkInterfaces()){
 const localHosts=new Set(ports.flatMap(port=>[`localhost:${port}`,`127.0.0.1:${port}`,`[::1]:${port}`]));
 const lanHosts=new Set<string>();
 for(const entry of Object.values(interfaces).flatMap(entries=>entries||[])){
  if(entry.internal||!privateNetworkAddress(entry.address)||entry.address.includes('%'))continue;
  const host=isIP(entry.address)===6?`[${entry.address}]`:entry.address;
  for(const port of ports)lanHosts.add(new URL(`http://${host}:${port}`).host);
 }
 return (address:string|undefined,host:string)=>loopbackAddress(address)?localHosts.has(host)||lanHosts.has(host):privateNetworkAddress(address)&&lanHosts.has(host);
}
