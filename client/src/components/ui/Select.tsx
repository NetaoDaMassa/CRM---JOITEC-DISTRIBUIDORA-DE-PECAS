import type { SelectHTMLAttributes } from 'react'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string | number; label: string }[]
  placeholder?: string
}

export default function Select({ label, error, options, placeholder, className = '', ...props }: SelectProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-sm text-dark-200 font-medium">{label}</label>}
      <select
        {...props}
        className={`
          w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm
          text-dark-100 focus:outline-none focus:border-gold-600 focus:ring-1 focus:ring-gold-600/30
          disabled:opacity-50 cursor-pointer
          ${error ? 'border-red-500' : ''}
          ${className}
        `}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  )
}
