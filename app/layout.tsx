import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata:Metadata={title:'拾趣 · 片刻入戏，久久回味',description:'选择一本古典名著或一种心情，滑动读完一段有余味的故事。',manifest:'/manifest.webmanifest',appleWebApp:{capable:true,title:'拾趣',statusBarStyle:'black-translucent'},icons:{icon:'/icon.svg',apple:'/icon-192.png'}};
export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#f7f6ef'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}
