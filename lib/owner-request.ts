import { headers } from "next/headers";

export async function isOwnerRequest() {
  return Boolean((await headers()).get("oai-authenticated-user-email"));
}
