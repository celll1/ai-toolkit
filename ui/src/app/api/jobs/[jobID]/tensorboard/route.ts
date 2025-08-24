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
    console.log('Parsing tensorboard log from:', logPath);
    
    if (!existsSync(logPath)) {
      console.log('Log path does not exist:', logPath);
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

    console.log('Found event files:', files.map(f => f.name));

    if (files.length === 0) {
      console.log('No event files found');
      return data;
    }

    const eventFile = files[0].path;
    console.log('Using event file:', eventFile);
    
    // Read the tensorboard event file
    const buffer = readFileSync(eventFile);
    console.log('Event file size:', buffer.length, 'bytes');
    
    // Simplified TFRecord parsing - TensorBoard files use TFRecord format
    // TFRecord format: [length (8 bytes)][masked_crc (4 bytes)][data][data_crc (4 bytes)]
    let offset = 0;
    let recordCount = 0;
    
    while (offset < buffer.length - 16) { // Need at least 16 bytes for TFRecord header + footer
      try {
        // Read record length (8 bytes, little endian)
        const length = Number(buffer.readBigUInt64LE(offset));
        
        if (length <= 0 || length > buffer.length - offset - 16) {
          offset += 1;
          continue;
        }
        
        offset += 8; // Skip length
        offset += 4; // Skip masked CRC
        
        // Read the protobuf data
        const eventData = buffer.subarray(offset, offset + length);
        offset += length;
        offset += 4; // Skip data CRC
        
        recordCount++;
        
        // Try to parse as protobuf Event message
        // This is a simplified approach - we look for common patterns
        
        // Convert to string for pattern matching (this works for simple scalar values)
        const dataStr = eventData.toString('binary');
        
        // Look for step numbers and scalar values using regex patterns
        // This is less precise but more robust than proper protobuf parsing
        
        // Try to extract step number
        const stepMatches = dataStr.match(/\x10([\x00-\x7f]+)/); // Field 2, varint
        let step: number | null = null;
        
        if (stepMatches) {
          // Decode varint manually (simplified)
          const varintBytes = stepMatches[1];
          let stepVal = 0;
          for (let i = 0; i < varintBytes.length && i < 4; i++) {
            const byte = varintBytes.charCodeAt(i);
            if (byte & 0x80) {
              stepVal |= (byte & 0x7f) << (i * 7);
            } else {
              stepVal |= byte << (i * 7);
              break;
            }
          }
          step = stepVal;
        }
        
        // Look for tag names and scalar values
        const tagMatches = [...dataStr.matchAll(/\x0a([\x01-\x1f])([\x20-\x7e]+)/g)]; // String fields
        const scalarMatches = [...dataStr.matchAll(/\x15(.{4})/g)]; // Float32 fields
        
        for (let i = 0; i < tagMatches.length && i < scalarMatches.length; i++) {
          const tagMatch = tagMatches[i];
          const scalarMatch = scalarMatches[i];
          
          if (tagMatch && scalarMatch && step !== null) {
            const tagName = tagMatch[2];
            
            // Parse float32 value
            const floatBytes = new Uint8Array(4);
            for (let j = 0; j < 4; j++) {
              floatBytes[j] = scalarMatch[1].charCodeAt(j);
            }
            const view = new DataView(floatBytes.buffer);
            const scalarValue = view.getFloat32(0, true); // little endian
            
            const wallTime = Date.now() / 1000;
            
            if (tagName.toLowerCase().includes('loss')) {
              data.loss.push({
                step,
                value: scalarValue,
                wall_time: wallTime
              });
              console.log(`Found loss: step=${step}, value=${scalarValue}`);
            } else if (tagName.toLowerCase().includes('lr') || tagName.toLowerCase().includes('learning_rate')) {
              data.learning_rate.push({
                step,
                value: scalarValue,
                wall_time: wallTime
              });
              console.log(`Found LR: step=${step}, value=${scalarValue}`);
            }
          }
        }
        
      } catch (e) {
        // Skip this record if parsing fails
        offset += 1;
      }
    }
    
    console.log(`Processed ${recordCount} records`);
    
    // Remove duplicates and sort by step
    data.loss = Array.from(new Map(data.loss.map(item => [item.step, item])).values())
      .sort((a, b) => a.step - b.step);
    data.learning_rate = Array.from(new Map(data.learning_rate.map(item => [item.step, item])).values())
      .sort((a, b) => a.step - b.step);
    
    console.log(`Final data: loss=${data.loss.length} points, lr=${data.learning_rate.length} points`);
    
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

    // Find tensorboard log directory from job configuration
    const jobConfig = JSON.parse(job.job_config);
    const processConfig = jobConfig?.config?.process?.[0];
    
    const logDir = processConfig?.log_dir;
    
    if (!logDir) {
      console.log('No log_dir specified in job configuration');
      return NextResponse.json({ 
        loss: [], 
        learning_rate: [] 
      });
    }

    if (!existsSync(logDir)) {
      console.log('Tensorboard log directory does not exist:', logDir);
      return NextResponse.json({ 
        loss: [], 
        learning_rate: [] 
      });
    }

    let data: TensorboardData = { loss: [], learning_rate: [] };

    console.log('Using tensorboard log directory:', logDir);

    try {
      // Get the job name from configuration
      const jobName = processConfig?.name || job.name;
      console.log('Looking for tensorboard directories matching job name:', jobName);
      
      // Find directories that match the job name pattern (job_name + timestamp)
      const allDirs = readdirSync(logDir)
        .map(dir => ({
          name: dir,
          path: join(logDir, dir),
          mtime: statSync(join(logDir, dir)).mtime
        }))
        .filter(dir => {
          try {
            const isDirectory = statSync(dir.path).isDirectory();
            const matchesJobName = dir.name.startsWith(jobName);
            console.log(`Directory ${dir.name}: isDirectory=${isDirectory}, matchesJobName=${matchesJobName}`);
            return isDirectory && matchesJobName;
          } catch (error) {
            console.log(`Error checking directory ${dir.name}:`, error);
            return false;
          }
        })
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      console.log('Found matching tensorboard directories:', allDirs.map(d => d.name));

      if (allDirs.length === 0) {
        console.log(`No directories found matching job name "${jobName}" in ${logDir}`);
        // Also list all directories for debugging
        const allDirsDebug = readdirSync(logDir).filter(dir => {
          try {
            return statSync(join(logDir, dir)).isDirectory();
          } catch {
            return false;
          }
        });
        console.log('All available directories:', allDirsDebug);
        
        return NextResponse.json({ 
          loss: [], 
          learning_rate: [] 
        });
      }

      // Parse the most recent log directory
      console.log('Using directory:', allDirs[0].path);
      data = parseTensorboardLog(allDirs[0].path);
      console.log('Parsed tensorboard data:', { 
        lossCount: data.loss.length, 
        lrCount: data.learning_rate.length 
      });
    } catch (error) {
      console.error('Error reading tensorboard directory:', error);
    }

    return NextResponse.json(data);

  } catch (error) {
    console.error('Error fetching tensorboard data:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}