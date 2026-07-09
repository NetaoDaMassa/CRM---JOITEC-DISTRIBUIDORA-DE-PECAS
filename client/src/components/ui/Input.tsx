import type { InputHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: ReactNode
}

export function Input({ label, error, icon, className = '', ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-sm text-dark-200 font-medium">{label}</label>}
      <div className="relative">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400">{icon}</span>
        )}
        <input
          {...props}
          className={`
            w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm
            text-dark-100 placeholder-dark-400
            focus:outline-none focus:border-gold-600 focus:ring-1 focus:ring-gold-600/30
            disabled:opacity-50 disabled:cursor-not-allowed
            ${icon ? 'pl-9' : ''}
            ${error ? 'border-red-500' : ''}
            ${className}
          `}
        />
      </div>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  )
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export function Textarea({ label, error, className = '', ...props }: TextareaProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-sm text-dark-200 font-medium">{label}</label>}
      <textarea
        {...props}
        className={`
          w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm
          text-dark-100 placeholder-dark-400 resize-none
          focus:outline-none focus:border-gold-600 focus:ring-1 focus:ring-gold-600/30
          disabled:opacity-50
          ${error ? 'border-red-500' : ''}
          ${className}
        `}
      />
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  )
}
