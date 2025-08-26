import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import { getTrainingFolder } from '@/server/settings';

const prisma = new PrismaClient();

export async function GET(request: NextRequest, { params }: { params: { jobID: string } }) {
  const { jobID } = await params;

  const job = await prisma.job.findUnique({
    where: { id: jobID },
  });

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  // setup the training
  const trainingFolder = await getTrainingFolder();

  const samplesFolder = path.join(trainingFolder, job.name, 'samples');
  if (!fs.existsSync(samplesFolder)) {
    return NextResponse.json({ samples: [] });
  }

  // find all img (png, jpg, jpeg) files in the samples folder with metadata
  const samples = fs
    .readdirSync(samplesFolder)
    .filter(file => {
      return file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.webp');
    })
    .map(file => {
      const fullPath = path.join(samplesFolder, file);
      const stats = fs.statSync(fullPath);
      
      // Extract sample index from filename
      // Format is usually: <timestamp>_<padded_step>_<sample_index>.<ext>
      // Example: "1703123456__00000500_0.png" where 0 is the sample index
      const parts = file.split('.')[0].split('_');
      const sampleIndex = parts.length > 0 ? parseInt(parts[parts.length - 1]) || 0 : 0;
      
      return {
        path: fullPath,
        filename: file,
        step: 0, // We can't reliably extract training step from filename
        sampleIndex,
        createdAt: stats.ctime.toISOString(),
        size: stats.size
      };
    })
    .sort((a, b) => {
      // Sort by creation time descending (newest first)
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  return NextResponse.json({ samples });
}
