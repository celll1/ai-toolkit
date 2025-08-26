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
      
      // Extract step from filename (e.g., "sample_step_1000_0.png" -> 1000)
      const stepMatch = file.match(/step_(\d+)/);
      const step = stepMatch ? parseInt(stepMatch[1]) : 0;
      
      // Extract sample index (e.g., "sample_step_1000_0.png" -> 0)
      const indexMatch = file.match(/_(\d+)\.[^.]+$/);
      const sampleIndex = indexMatch ? parseInt(indexMatch[1]) : 0;
      
      return {
        path: fullPath,
        filename: file,
        step,
        sampleIndex,
        createdAt: stats.ctime.toISOString(),
        size: stats.size
      };
    })
    .sort((a, b) => {
      // Sort by step first, then by sample index
      if (a.step !== b.step) {
        return b.step - a.step; // Newest steps first
      }
      return a.sampleIndex - b.sampleIndex;
    });

  return NextResponse.json({ samples });
}
