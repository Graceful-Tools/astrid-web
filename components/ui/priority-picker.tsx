import { Button } from "./button"
import { Label } from "./label"

interface PriorityPickerProps {
  value: number
  onChange: (priority: number) => void
  label?: string
  showLabel?: boolean
  className?: string
  /**
   * Render the controls inert AND visibly unavailable. Defaults false, so
   * existing callers are unchanged.
   *
   * Added because task detail's read-only mode gated every other field's click
   * but rendered this component ungated, leaving priority editable to viewers
   * who could not edit anything else. (Task 72cb4a13.)
   */
  disabled?: boolean
}

export function PriorityPicker({ value, onChange, disabled = false }: PriorityPickerProps) {
  return (
    <div className="flex space-x-2 mt-1 col-span-2">
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => onChange(0)}
        className={`w-10 h-10 flex items-center justify-center ${
          value === 0 
            ? "bg-gray-500 hover:bg-gray-600 active:bg-gray-600 !text-white hover:!text-white active:!text-white border-gray-500" 
            : "bg-transparent border-gray-500 text-gray-400 hover:bg-gray-700"
        }`}
      >
        <span>○</span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => onChange(1)}
        className={`w-10 h-10 flex items-center justify-center ${
          value === 1 
            ? "bg-blue-500 hover:bg-blue-600 active:bg-blue-600 !text-white hover:!text-white active:!text-white border-blue-500" 
            : "bg-transparent border-blue-500 text-blue-400 hover:bg-gray-700"
        }`}
      >
        <span>!</span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => onChange(2)}
        className={`w-10 h-10 flex items-center justify-center ${
          value === 2 
            ? "bg-yellow-500 hover:bg-yellow-600 active:bg-yellow-600 !text-white hover:!text-white active:!text-white border-yellow-500" 
            : "bg-transparent border-yellow-500 text-yellow-400 hover:bg-gray-700"
        }`}
      >
        <span>!!</span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => onChange(3)}
        className={`w-10 h-10 flex items-center justify-center ${
          value === 3 
            ? "bg-red-500 hover:bg-red-600 active:bg-red-600 !text-white hover:!text-white active:!text-white border-red-500" 
            : "bg-transparent border-red-500 text-red-400 hover:bg-gray-700"
        }`}
      >
        <span>!!!</span>
      </Button>
    </div>
  )
}
