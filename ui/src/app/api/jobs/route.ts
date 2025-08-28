import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import path from 'path';

const prisma = new PrismaClient();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  try {
    if (id) {
      const job = await prisma.job.findUnique({
        where: { id },
      });
      return NextResponse.json(job);
    }

    const jobs = await prisma.job.findMany({
      orderBy: { created_at: 'desc' },
    });
    return NextResponse.json({ jobs: jobs });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to fetch training data' }, { status: 500 });
  }
}

// Helper function to enrich dataset configurations with database settings
async function enrichDatasetConfigurations(datasets: any[]) {
  const enrichedDatasets = [];
  
  for (const dataset of datasets) {
    const enrichedDataset = { ...dataset };
    
    // Extract dataset name from folder path
    const datasetName = dataset.folder_path.split(/[/\\]/).pop();
    
    if (datasetName) {
      try {
        // Fetch dataset configuration from database
        const dbDataset = await prisma.dataset.findUnique({
          where: { name: datasetName }
        });
        
        if (dbDataset) {
          // Merge database configuration into dataset config
          enrichedDataset.caption_format = dbDataset.caption_format || 'txt';
          enrichedDataset.json_attribute = dbDataset.json_attribute || 'tags';
        }
      } catch (error) {
        console.error(`Error enriching dataset config for ${datasetName}:`, error);
        // Continue with default values if database lookup fails
      }
    }
    
    enrichedDatasets.push(enrichedDataset);
  }
  
  return enrichedDatasets;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, name, job_config, gpu_ids } = body;

    // Enrich dataset configurations with database settings
    if (job_config?.config?.process?.[0]?.datasets) {
      job_config.config.process[0].datasets = await enrichDatasetConfigurations(
        job_config.config.process[0].datasets
      );
    }

    if (id) {
      // Update existing training
      const training = await prisma.job.update({
        where: { id },
        data: {
          name,
          gpu_ids,
          job_config: JSON.stringify(job_config),
        },
      });
      return NextResponse.json(training);
    } else {
      // Create new training
      const training = await prisma.job.create({
        data: {
          name,
          gpu_ids,
          job_config: JSON.stringify(job_config),
        },
      });
      return NextResponse.json(training);
    }
  } catch (error: any) {
    if (error.code === 'P2002') {
      // Handle unique constraint violation, 409=Conflict
      return NextResponse.json({ error: 'Job name already exists' }, { status: 409 });
    }
    console.error(error);
    // Handle other errors
    return NextResponse.json({ error: 'Failed to save training data' }, { status: 500 });
  }
}
