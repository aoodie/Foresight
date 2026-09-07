import { headers } from "next/headers";
import { env } from 'cloudflare:workers';

export async function isOwnerRequest() {
  const owner = (env as unknown as {FORESIGHT_OWNER_EMAIL?:string}).FORESIGHT_OWNER_EMAIL?.trim().toLowerCase();
  return Boolean(owner && (await headers()).get('oai-authenticated-user-email')?.trim().toLowerCase() === owner);
}
