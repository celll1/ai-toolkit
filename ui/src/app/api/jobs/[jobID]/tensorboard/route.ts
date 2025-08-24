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
    
    // TFRecord format parsing with improved protobuf handling
    // TFRecord: [length (8 bytes LE)][masked_crc (4 bytes)][data][data_crc (4 bytes)]
    let offset = 0;
    let recordCount = 0;
    
    while (offset < buffer.length - 16) {
      try {
        // Read record length (8 bytes, little endian)
        const length = Number(buffer.readBigUInt64LE(offset));
        
        if (length <= 0 || length > 100000 || offset + 16 + length > buffer.length) {
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
        
        // Parse protobuf Event message more carefully
        let wallTime = 0;
        let step: number | null = null;
        
        // Parse protobuf fields
        let pos = 0;
        while (pos < eventData.length - 1) {
          const tag = eventData[pos];
          pos++;
          
          // Field 1: wall_time (double, wire type 1)
          if (tag === 0x09) {
            if (pos + 8 <= eventData.length) {
              const view = new DataView(eventData.buffer, eventData.byteOffset + pos, 8);
              wallTime = view.getFloat64(0, true);
              pos += 8;
            } else break;
          }
          // Field 2: step (int64, wire type 0)
          else if (tag === 0x10) {
            let stepVal = 0;
            let shift = 0;
            while (pos < eventData.length) {
              const byte = eventData[pos++];
              stepVal |= (byte & 0x7f) << shift;
              if ((byte & 0x80) === 0) break;
              shift += 7;
              if (shift >= 64) break;
            }
            step = stepVal;
          }
          // Field 5: summary (message, wire type 2)
          else if (tag === 0x2a) {
            if (pos >= eventData.length) break;
            
            let summaryLength = 0;
            let shift = 0;
            while (pos < eventData.length) {
              const byte = eventData[pos++];
              summaryLength |= (byte & 0x7f) << shift;
              if ((byte & 0x80) === 0) break;
              shift += 7;
            }
            
            if (pos + summaryLength <= eventData.length) {
              const summaryData = eventData.subarray(pos, pos + summaryLength);
              pos += summaryLength;
              
              // Parse Summary message
              parseSummary(summaryData, step, wallTime, data);
            }
          }
          // Skip unknown fields
          else {
            const wireType = tag & 0x07;
            if (wireType === 0) { // Varint
              while (pos < eventData.length && (eventData[pos] & 0x80)) pos++;
              if (pos < eventData.length) pos++;
            } else if (wireType === 1) { // 64-bit
              pos += 8;
            } else if (wireType === 2) { // Length-delimited
              if (pos >= eventData.length) break;
              let len = 0;
              let shift = 0;
              while (pos < eventData.length) {
                const byte = eventData[pos++];
                len |= (byte & 0x7f) << shift;
                if ((byte & 0x80) === 0) break;
                shift += 7;
              }
              pos += len;
            } else if (wireType === 5) { // 32-bit
              pos += 4;
            } else {
              break;
            }
          }
        }
        
      } catch (e) {
        console.error('Error parsing TFRecord at offset', offset, ':', e);
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

function parseSummary(summaryData: Uint8Array, step: number | null, wallTime: number, data: TensorboardData) {
  let pos = 0;
  
  while (pos < summaryData.length - 1) {
    const tag = summaryData[pos];
    pos++;
    
    // Field 1: value (repeated Value, wire type 2)
    if (tag === 0x0a) {
      if (pos >= summaryData.length) break;
      
      let valueLength = 0;
      let shift = 0;
      while (pos < summaryData.length) {
        const byte = summaryData[pos++];
        valueLength |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
      }
      
      if (pos + valueLength <= summaryData.length) {
        const valueData = summaryData.subarray(pos, pos + valueLength);
        pos += valueLength;
        
        parseValue(valueData, step, wallTime, data);
      }
    }
    // Skip other fields
    else {
      const wireType = tag & 0x07;
      if (wireType === 0) { // Varint
        while (pos < summaryData.length && (summaryData[pos] & 0x80)) pos++;
        if (pos < summaryData.length) pos++;
      } else if (wireType === 2) { // Length-delimited
        if (pos >= summaryData.length) break;
        let len = 0;
        let shift = 0;
        while (pos < summaryData.length) {
          const byte = summaryData[pos++];
          len |= (byte & 0x7f) << shift;
          if ((byte & 0x80) === 0) break;
          shift += 7;
        }
        pos += len;
      } else {
        break;
      }
    }
  }
}

function parseValue(valueData: Uint8Array, step: number | null, wallTime: number, data: TensorboardData) {
  let pos = 0;
  let tagName = '';
  let scalarValue: number | null = null;
  
  while (pos < valueData.length - 1) {
    const tag = valueData[pos];
    pos++;
    
    // Field 1: tag (string, wire type 2)
    if (tag === 0x0a) {
      if (pos >= valueData.length) break;
      
      let tagLength = 0;
      let shift = 0;
      while (pos < valueData.length) {
        const byte = valueData[pos++];
        tagLength |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
      }
      
      if (pos + tagLength <= valueData.length) {
        tagName = new TextDecoder().decode(valueData.subarray(pos, pos + tagLength));
        pos += tagLength;
      }
    }
    // Field 2: simple_value (float, wire type 5)
    else if (tag === 0x15) {
      if (pos + 4 <= valueData.length) {
        const view = new DataView(valueData.buffer, valueData.byteOffset + pos, 4);
        scalarValue = view.getFloat32(0, true);
        pos += 4;
      }
    }
    // Skip other fields
    else {
      const wireType = tag & 0x07;
      if (wireType === 0) { // Varint
        while (pos < valueData.length && (valueData[pos] & 0x80)) pos++;
        if (pos < valueData.length) pos++;
      } else if (wireType === 1) { // 64-bit
        pos += 8;
      } else if (wireType === 2) { // Length-delimited
        if (pos >= valueData.length) break;
        let len = 0;
        let shift = 0;
        while (pos < valueData.length) {
          const byte = valueData[pos++];
          len |= (byte & 0x7f) << shift;
          if ((byte & 0x80) === 0) break;
          shift += 7;
        }
        pos += len;
      } else if (wireType === 5) { // 32-bit
        pos += 4;
      } else {
        break;
      }
    }
  }
  
  // Store the parsed data
  if (step !== null && scalarValue !== null && tagName) {
    if (tagName.toLowerCase().includes('loss')) {
      data.loss.push({
        step,
        value: scalarValue,
        wall_time: wallTime || Date.now() / 1000
      });
      console.log(`Found loss: tag="${tagName}", step=${step}, value=${scalarValue}`);
    } else if (tagName.toLowerCase().includes('lr') || tagName.toLowerCase().includes('learning_rate')) {
      data.learning_rate.push({
        step,
        value: scalarValue,
        wall_time: wallTime || Date.now() / 1000
      });
      console.log(`Found LR: tag="${tagName}", step=${step}, value=${scalarValue}`);
    } else {
      console.log(`Found other metric: tag="${tagName}", step=${step}, value=${scalarValue}`);
    }
  }
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
    
    let logDir = processConfig?.log_dir;
    
    if (!logDir) {
      console.log('No log_dir specified in job configuration');
      return NextResponse.json({ 
        loss: [], 
        learning_rate: [] 
      });
    }

    // Check if we need to look in the .tensorboard subdirectory
    // Try the configured path first, then try .tensorboard subdirectory
    const possibleLogDirs = [
      logDir,
      join(logDir, '.tensorboard')
    ];

    let actualLogDir = null;
    for (const candidate of possibleLogDirs) {
      if (existsSync(candidate)) {
        actualLogDir = candidate;
        console.log(`Found tensorboard directory: ${candidate}`);
        break;
      }
    }

    if (!actualLogDir) {
      console.log('Tensorboard log directory does not exist. Tried:', possibleLogDirs);
      return NextResponse.json({ 
        loss: [], 
        learning_rate: [] 
      });
    }

    logDir = actualLogDir;

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
            // Prefer directories with timestamps (job_name_YYYYMMDD-HHMMSS format)
            const hasTimestamp = dir.name.includes('_20') && dir.name.match(/_\d{8}-\d{6}$/);
            console.log(`Directory ${dir.name}: isDirectory=${isDirectory}, matchesJobName=${matchesJobName}, hasTimestamp=${hasTimestamp}`);
            return isDirectory && matchesJobName;
          } catch (error) {
            console.log(`Error checking directory ${dir.name}:`, error);
            return false;
          }
        })
        .sort((a, b) => {
          // First prioritize directories with timestamps
          const aHasTimestamp = a.name.includes('_20') && a.name.match(/_\d{8}-\d{6}$/);
          const bHasTimestamp = b.name.includes('_20') && b.name.match(/_\d{8}-\d{6}$/);
          
          if (aHasTimestamp && !bHasTimestamp) return -1;
          if (!aHasTimestamp && bHasTimestamp) return 1;
          
          // If both have timestamps or both don't, sort by modification time
          return b.mtime.getTime() - a.mtime.getTime();
        });

      console.log('Found matching tensorboard directories (sorted):', allDirs.map(d => d.name));

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

      // Parse the most recent timestamped log directory (or latest if no timestamps)
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