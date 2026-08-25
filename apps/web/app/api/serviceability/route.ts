import { type NextRequest, NextResponse } from 'next/server';
import { serviceability } from '@/lib/data';

export async function GET(req: NextRequest) {
  const pincode = (req.nextUrl.searchParams.get('pincode') ?? '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(pincode)) return NextResponse.json({ serviceable: false, note: 'Enter a 6-digit pincode' }, { status: 400 });
  return NextResponse.json(await serviceability(pincode), { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
