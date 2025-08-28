import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getDatasetsRoot } from '@/server/settings';
import path from 'path';

const prisma = new PrismaClient();

export async function GET(
  request: NextRequest,
  { params }: { params: { datasetName: string } }
) {
  try {
    const { datasetName } = await params;
    
    const dataset = await prisma.dataset.findUnique({
      where: { name: datasetName }
    });

    if (!dataset) {
      return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
    }

    const datasetRoot = await getDatasetsRoot();
    
    // Build the dataset configuration for training
    const trainingConfig = {
      folder_path: dataset.external_path || path.join(datasetRoot, datasetName),
      caption_format: dataset.caption_format || 'txt',
      json_attribute: dataset.json_attribute || 'tags'
    };

    return NextResponse.json(trainingConfig);

  } catch (error) {
    console.error('Error getting dataset training config:', error);
    return NextResponse.json({ error: 'Failed to get dataset training config' }, { status: 500 });
  }
}