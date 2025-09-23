import Link from 'next/link';
import { Eye, Trash2, Pen, Play, Pause, Copy } from 'lucide-react';
import { Button } from '@headlessui/react';
import { openConfirm } from '@/components/ConfirmModal';
import { Job } from '@prisma/client';
import { startJob, stopJob, deleteJob, getAvaliableJobActions } from '@/utils/jobs';
import { useRouter } from 'next/navigation';

interface JobActionBarProps {
  job: Job;
  onRefresh?: () => void;
  afterDelete?: () => void;
  hideView?: boolean;
  className?: string;
}

export default function JobActionBar({ job, onRefresh, afterDelete, className, hideView }: JobActionBarProps) {
  const { canStart, canStop, canDelete, canEdit } = getAvaliableJobActions(job);
  const router = useRouter();

  if (!afterDelete) afterDelete = onRefresh;

  const handleCopyJob = () => {
    // Parse the job config to create a copy with modified name
    const jobConfig = JSON.parse(job.job_config);
    jobConfig.meta.name = `${jobConfig.meta.name}_copy`;
    jobConfig.config.name = `${jobConfig.config.name}_copy`;
    
    // Encode the config and navigate to new job page with the config
    const encodedConfig = encodeURIComponent(JSON.stringify(jobConfig));
    router.push(`/jobs/new?config=${encodedConfig}`);
  };

  return (
    <div className={`${className}`}>
      {canStart && (
        <Button
          onClick={async () => {
            if (!canStart) return;
            await startJob(job.id);
            if (onRefresh) onRefresh();
          }}
          className={`ml-2 opacity-100`}
        >
          <Play />
        </Button>
      )}
      {canStop && (
        <Button
          onClick={() => {
            if (!canStop) return;
            openConfirm({
              title: 'Stop Job',
              message: `Are you sure you want to stop the job "${job.name}"? You CAN resume later.`,
              type: 'info',
              confirmText: 'Stop',
              onConfirm: async () => {
                await stopJob(job.id);
                if (onRefresh) onRefresh();
              },
            });
          }}
          className={`ml-2 opacity-100`}
        >
          <Pause />
        </Button>
      )}
      {!hideView && (
        <Link href={`/jobs/${job.id}`} className="ml-2 text-gray-200 hover:text-gray-100 inline-block">
          <Eye />
        </Link>
      )}
      {canEdit && (
        <Link href={`/jobs/new?id=${job.id}`} className="ml-2 hover:text-gray-100 inline-block">
          <Pen />
        </Link>
      )}
      <Button
        onClick={handleCopyJob}
        className="ml-2 hover:text-gray-100"
        title="Copy job configuration"
      >
        <Copy />
      </Button>
      <Button
        onClick={() => {
          let message = `Are you sure you want to delete the job "${job.name}"? This will also permanently remove it from your disk.`;
          if (job.status === 'running') {
            message += ' WARNING: The job is currently running. You should stop it first if you can.';
          }
          openConfirm({
            title: 'Delete Job',
            message: message,
            type: 'warning',
            confirmText: 'Delete',
            onConfirm: async () => {
              if (job.status === 'running') {
                try {
                  await stopJob(job.id);
                } catch (e) {
                  console.error('Error stopping job before deleting:', e);
                }
              }
              await deleteJob(job.id);
              if (afterDelete) afterDelete();
            },
          });
        }}
        className={`ml-2 opacity-100`}
      >
        <Trash2 />
      </Button>
    </div>
  );
}
