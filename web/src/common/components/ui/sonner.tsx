'use client';

import { Toaster as Sonner, type ToasterProps } from 'sonner';

const SonnerToaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      richColors
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast border border-cyber-border bg-cyber-surface text-cyber-text shadow-lg',
          description: 'text-cyber-textmuted',
          actionButton: 'bg-cyber-primary text-cyber-bg',
          cancelButton: 'bg-cyber-surface2 text-cyber-text',
          success: 'border-safe/40',
          error: 'border-severity-critical/40',
          warning: 'border-severity-medium/40',
          info: 'border-cyber-primary/40',
        },
      }}
      {...props}
    />
  );
};

export { SonnerToaster };
