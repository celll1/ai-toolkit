import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

export async function POST(request: NextRequest, { params }: { params: { jobID: string } }) {
  const { jobID } = await params;

  try {
    const job = await prisma.job.findUnique({
      where: { id: jobID },
    });

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (job.status !== 'running') {
      return NextResponse.json({ error: 'Job is not running' }, { status: 400 });
    }

    // Create a flag file to signal the training process
    const outputDir = path.join(process.cwd(), 'output', job.name);
    const flagFile = path.join(outputDir, '.generate_sample_now');

    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write flag file
    fs.writeFileSync(flagFile, Date.now().toString());

    return NextResponse.json({
      success: true,
      message: 'Sample generation requested. It will be generated at the next training step.'
    });
  } catch (error) {
    console.error('Error requesting sample generation:', error);
    return NextResponse.json({ error: 'Failed to request sample generation' }, { status: 500 });
  }
}
