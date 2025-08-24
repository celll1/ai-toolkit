import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

interface TensorboardEvent {
  step: number;
  value: number;
  wall_time: number;
}

interface TensorboardData {
  loss: TensorboardEvent[];
  learning_rate: TensorboardEvent[];
}

function parseTensorboardLog(logPath: string): TensorboardData {
  const data: TensorboardData = {
    loss: [],
    learning_rate: []
  };

  try {
    if (!existsSync(logPath)) {
      return data;
    }

    // Find the most recent event file
    const files = readdirSync(logPath)
      .filter(file => file.startsWith('events.out.tfevents'))
      .map(file => ({
        name: file,
        path: join(logPath, file),
        mtime: statSync(join(logPath, file)).mtime
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    if (files.length === 0) {
      return data;
    }

    const eventFile = files[0].path;
    
    // Read the tensorboard event file
    const buffer = readFileSync(eventFile);
    
    // Tensorboard events are stored in TFRecord format with protobuf
    // This is a more robust parser that looks for the actual protobuf structure
    let offset = 0;
    
    while (offset < buffer.length - 12) { // Need at least 12 bytes for TFRecord header
      try {
        // TFRecord format: [length][crc32][data][crc32]
        const length = buffer.readBigUInt64LE(offset);
        if (length > BigInt(buffer.length - offset) || length < BigInt(0)) {
          offset += 1;
          continue;
        }
        
        const lengthNum = Number(length);
        offset += 8;
        
        // Skip CRC32 for data length
        offset += 4;
        
        if (offset + lengthNum + 4 > buffer.length) {
          break;
        }
        
        // Read the event data (protobuf)
        const eventData = buffer.subarray(offset, offset + lengthNum);
        
        // Parse the protobuf-like structure for step and scalar values
        // Look for step value (usually appears as varint)
        let step: number | null = null;
        let scalarValue: number | null = null;
        let tagName: string = '';
        
        // Simple protobuf field parsing
        for (let i = 0; i < eventData.length - 4; i++) {
          // Look for step field (field 2 in Event proto)
          if (eventData[i] === 0x10) { // Wire type 0, field 2
            let stepVal = 0;
            let shift = 0;
            let j = i + 1;
            while (j < eventData.length && (eventData[j] & 0x80)) {
              stepVal |= (eventData[j] & 0x7F) << shift;
              shift += 7;
              j++;
            }
            if (j < eventData.length) {
              stepVal |= (eventData[j] & 0x7F) << shift;
              step = stepVal;
            }
          }
          
          // Look for summary field (field 5) containing scalar values
          if (eventData[i] === 0x2A) { // Wire type 2, field 5
            const summaryLength = eventData[i + 1];
            if (i + 2 + summaryLength < eventData.length) {
              const summaryData = eventData.subarray(i + 2, i + 2 + summaryLength);
              
              // Look for tag field in summary
              for (let k = 0; k < summaryData.length - 4; k++) {
                if (summaryData[k] === 0x0A) { // Wire type 2, field 1 (tag)
                  const tagLength = summaryData[k + 1];
                  if (k + 2 + tagLength < summaryData.length) {
                    tagName = summaryData.subarray(k + 2, k + 2 + tagLength).toString('utf8');
                  }
                }
                
                // Look for simple_value field (field 2 in Value proto)
                if (summaryData[k] === 0x15) { // Wire type 5, field 2 (float32)
                  if (k + 5 <= summaryData.length) {
                    const floatBytes = summaryData.subarray(k + 1, k + 5);
                    const view = new DataView(floatBytes.buffer, floatBytes.byteOffset, 4);
                    scalarValue = view.getFloat32(0, true); // little endian
                  }
                }
              }
            }
          }
        }
        
        // Store the parsed data
        if (step !== null && scalarValue !== null && tagName) {
          const wallTime = Date.now() / 1000;
          
          if (tagName.includes('loss') || tagName.includes('Loss')) {
            data.loss.push({
              step,
              value: scalarValue,
              wall_time: wallTime
            });
          } else if (tagName.includes('learning_rate') || tagName.includes('lr')) {
            data.learning_rate.push({
              step,
              value: scalarValue,
              wall_time: wallTime
            });
          }
        }
        
        offset += lengthNum;
        offset += 4; // Skip trailing CRC32
        
      } catch (e) {
        // Skip this record if parsing fails
        offset += 1;
      }
    }
    
    // Remove duplicates and sort by step
    data.loss = Array.from(new Map(data.loss.map(item => [item.step, item])).values())
      .sort((a, b) => a.step - b.step);
    data.learning_rate = Array.from(new Map(data.learning_rate.map(item => [item.step, item])).values())
      .sort((a, b) => a.step - b.step);
    
    // Keep only the last 1000 points for performance
    if (data.loss.length > 1000) {
      data.loss = data.loss.slice(-1000);
    }
    if (data.learning_rate.length > 1000) {
      data.learning_rate = data.learning_rate.slice(-1000);
    }
    
  } catch (error) {
    console.error('Error parsing tensorboard log:', error);
  }

  return data;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { jobID: string } }
) {
  try {
    const job = await prisma.job.findUnique({
      where: { id: params.jobID }
    });

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Find tensorboard log directory
    // The log directory should be in the job's training folder
    const jobConfig = JSON.parse(job.job_config);
    const processConfig = jobConfig?.config?.process?.[0];
    
    if (!processConfig?.log_dir) {
      return NextResponse.json({ 
        loss: [], 
        learning_rate: [] 
      });
    }

    // Look for the most recent log directory for this job
    const logDir = processConfig.log_dir;
    
    if (!existsSync(logDir)) {
      return NextResponse.json({ 
        loss: [], 
        learning_rate: [] 
      });
    }

    // Find directories that match the job name pattern
    const jobName = processConfig.name || job.name;
    const logDirs = readdirSync(logDir)
      .filter(dir => dir.startsWith(jobName))
      .map(dir => ({
        name: dir,
        path: join(logDir, dir),
        mtime: statSync(join(logDir, dir)).mtime
      }))
      .filter(dir => statSync(dir.path).isDirectory())
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    if (logDirs.length === 0) {
      return NextResponse.json({ 
        loss: [], 
        learning_rate: [] 
      });
    }

    // Parse the most recent log directory
    const data = parseTensorboardLog(logDirs[0].path);

    return NextResponse.json(data);

  } catch (error) {
    console.error('Error fetching tensorboard data:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}