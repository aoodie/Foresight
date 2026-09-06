import { NextResponse } from 'next/server';
import { isOwnerRequest } from '@/lib/owner-request';
import { automaticStatus,runAutomaticResearch,setAutomaticEnabled } from '@/lib/quant/automatic';
export async function GET(){if(!(await isOwnerRequest()))return NextResponse.json({error:'Unauthorised'},{status:401});try{return NextResponse.json(await automaticStatus());}catch{return NextResponse.json({error:'Automatic research storage is unavailable.'},{status:503});}}
export async function POST(request:Request){
 if(!(await isOwnerRequest()))return NextResponse.json({error:'Unauthorised'},{status:401});
 try{const body=await request.json();if(body.action==='pause'||body.action==='enable'){await setAutomaticEnabled(body.action==='enable');return NextResponse.json(await automaticStatus());}
 if(body.action!=='tick')return NextResponse.json({error:'Unknown research action.'},{status:400});
 return NextResponse.json(await runAutomaticResearch());}catch{return NextResponse.json({error:'Could not update automatic research. Check connections and try again.'},{status:503});}
}
