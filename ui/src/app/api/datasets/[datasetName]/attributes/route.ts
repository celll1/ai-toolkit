import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

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

    // Parse available attributes from database
    let availableAttributes = [];
    if (dataset.available_attributes) {
      try {
        availableAttributes = JSON.parse(dataset.available_attributes);
      } catch (error) {
        console.error('Error parsing available attributes:', error);
      }
    }

    return NextResponse.json({
      availableAttributes,
      hasJsonFiles: availableAttributes.length > 0
    });

  } catch (error) {
    console.error('Error getting dataset attributes:', error);
    return NextResponse.json({ error: 'Failed to get dataset attributes' }, { status: 500 });
  }
}