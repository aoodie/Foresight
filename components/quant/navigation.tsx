"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
const links=[['/','Dashboard'],['/markets','Market scanner'],['/open-trades','Open trades'],['/journal','Journal'],['/strategies','Strategy library'],['/quant-research','Quant research'],['/strategy-health','Strategy health'],['/risk','Risk'],['/system-health','System health']] as const;
export function PlatformNavigation(){const path=usePathname();return <nav className="platform-nav" aria-label="Foresight workspace">{links.map(([href,label])=><Link key={href} href={href} aria-current={path===href?'page':undefined}>{label}</Link>)}</nav>;}
