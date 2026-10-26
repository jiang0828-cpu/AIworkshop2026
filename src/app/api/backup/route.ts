import { GET as exportBackup, POST as restoreBackup } from "@/lib/workspace-backup-service";

export async function GET() { return exportBackup(); }
export async function POST(request: Request) { return restoreBackup(request); }
