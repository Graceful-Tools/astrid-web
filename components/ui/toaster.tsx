"use client"

import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast"
import { useToast, useToasterMounted } from "@/hooks/use-toast"
import { useSettings } from "@/contexts/settings-context"

export function Toaster() {
  const { toasts } = useToast()
  useToasterMounted()
  const { toastDebugMode } = useSettings()

  return (
    <ToastProvider>
      {toasts.map(({ id, title, description, action, ...props }) => {
        const isError = props.variant === "destructive" || title === "Error" || title === "Access Denied"
        const variant = isError ? "destructive" : "default"
        
        return (
          <Toast 
            key={id} 
            {...props} 
            variant={toastDebugMode ? variant : "default"}
            debugMode={toastDebugMode}
            subtleColor={isError ? "destructive" : "default"}
          >
            <div className={toastDebugMode ? "grid gap-1" : "sr-only"}>
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            <div className={toastDebugMode ? "" : "sr-only"}>{action}</div>
            {toastDebugMode && <ToastClose />}
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
