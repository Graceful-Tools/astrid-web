"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Upload, Image as ImageIcon, Palette, Check } from "lucide-react"
import { getPlaceholderOptions, type PlaceholderOption } from "@/lib/placeholder-utils"
import { DEFAULT_LIST_IMAGES } from "@/lib/default-images"

interface ImagePickerProps {
  currentImageUrl?: string
  onSelectImage: (imageUrl: string, type: 'placeholder' | 'custom' | 'generated') => void
  onCancel: () => void
  listName?: string
  listId?: string
}

export function ImagePicker({ currentImageUrl, onSelectImage, onCancel, listName, listId }: ImagePickerProps) {
  const [selectedPlaceholder, setSelectedPlaceholder] = useState<string | null>(null)
  const [selectedDefaultIcon, setSelectedDefaultIcon] = useState<string | null>(null)
  const [customImageUrl, setCustomImageUrl] = useState("")

  // Initialize selectedDefaultIcon if currentImageUrl matches a default icon
  useEffect(() => {
    if (currentImageUrl) {
      const matchingIcon = DEFAULT_LIST_IMAGES.find(icon => icon.filename === currentImageUrl)
      if (matchingIcon) {
        setSelectedDefaultIcon(matchingIcon.filename)
      }
    }
  }, [currentImageUrl])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const placeholderOptions = getPlaceholderOptions()

  const handleSelectPlaceholder = (placeholder: PlaceholderOption) => {
    setSelectedPlaceholder(placeholder.path)
    setSelectedDefaultIcon(null) // Clear default icon selection
    setCustomImageUrl("") // Clear custom image
    onSelectImage(placeholder.path, 'placeholder')
  }

  const handleSelectDefaultIcon = (icon: any) => {
    setSelectedDefaultIcon(icon.filename)
    setSelectedPlaceholder(null) // Clear placeholder selection
    setCustomImageUrl("") // Clear custom image
    onSelectImage(icon.filename, 'placeholder')
  }

  const handleCustomImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!listId) {
      console.error('No list ID provided for upload')
      // Fallback to data URL for dev use when no listId
      const reader = new FileReader()
      reader.onload = (e) => {
        const result = e.target?.result as string
        if (result) {
          setCustomImageUrl(result)
          onSelectImage(result, 'custom')
        }
      }
      reader.readAsDataURL(file)
      return
    }

    try {
      // Upload file using secure upload system
      const formData = new FormData()
      formData.append('file', file)
      formData.append('context', JSON.stringify({
        listId: listId
      }))

      const response = await fetch('/api/v1/secure-upload/request-upload', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error('Failed to upload file')
      }

      const data = await response.json()

      if (data.fileId) {
        const imageUrl = `/api/v1/secure-files/${data.fileId}`
        setCustomImageUrl(imageUrl)
        onSelectImage(imageUrl, 'custom')
      } else {
        console.error('Upload failed:', data)
        throw new Error('Upload response missing fileId')
      }
    } catch (error) {
      console.error('Upload error:', error)
      // Fallback to data URL for offline/dev use
      const reader = new FileReader()
      reader.onload = (e) => {
        const result = e.target?.result as string
        if (result) {
          setCustomImageUrl(result)
          onSelectImage(result, 'custom')
        }
      }
      reader.readAsDataURL(file)
    }
  }

  const handleCustomUrlSubmit = () => {
    if (customImageUrl.trim()) {
      onSelectImage(customImageUrl.trim(), 'custom')
    }
  }


  return (
    <Card className="theme-bg-primary theme-border w-full max-w-2xl mx-4 p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold theme-text-primary">Choose Image</h2>
        <Button variant="ghost" size="sm" onClick={onCancel} className="theme-text-muted hover:theme-text-primary">
          ×
        </Button>
      </div>

      <Tabs defaultValue="placeholders" className="w-full">
        <TabsList className="grid w-full grid-cols-3 theme-bg-secondary">
          <TabsTrigger value="placeholders" className="theme-text-secondary data-[state=active]:theme-text-primary">
            <Palette className="w-4 h-4 mr-2" />
            Colors
          </TabsTrigger>
          <TabsTrigger value="defaults" className="theme-text-secondary data-[state=active]:theme-text-primary">
            <ImageIcon className="w-4 h-4 mr-2" />
            Defaults
          </TabsTrigger>
          <TabsTrigger value="upload" className="theme-text-secondary data-[state=active]:theme-text-primary">
            <Upload className="w-4 h-4 mr-2" />
            Upload
          </TabsTrigger>
        </TabsList>

        <TabsContent value="placeholders" className="space-y-4 mt-6">
          <div className="grid grid-cols-4 gap-3">
            {placeholderOptions.map((option) => (
              <button
                key={option.name}
                onClick={() => handleSelectPlaceholder(option)}
                className={`relative group aspect-square rounded-lg overflow-hidden transition-all ${
                  selectedPlaceholder === option.path
                    ? 'ring-2 ring-blue-500 ring-offset-2 theme-ring-offset'
                    : 'hover:scale-105 hover:shadow-lg'
                }`}
              >
                <img
                  src={option.path}
                  alt={option.label}
                  className="w-full h-full object-cover"
                />
                {selectedPlaceholder === option.path && (
                  <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                    <Check className="w-6 h-6 text-white" />
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1 text-center">
                  {option.label}
                </div>
              </button>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="defaults" className="space-y-4 mt-6">
          <div className="grid grid-cols-4 gap-3">
            {DEFAULT_LIST_IMAGES.map((icon) => (
              <button
                key={icon.name}
                onClick={() => handleSelectDefaultIcon(icon)}
                className={`relative group w-16 h-16 rounded-lg overflow-hidden transition-all ${
                  selectedDefaultIcon === icon.filename
                    ? 'ring-2 ring-blue-500 ring-offset-2 theme-ring-offset'
                    : 'hover:scale-105 hover:shadow-lg'
                }`}
              >
                <img
                  src={icon.filename}
                  alt={icon.name}
                  className="w-full h-full object-cover"
                />
                {selectedDefaultIcon === icon.filename && (
                  <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1 text-center">
                  {icon.name === "Default List 0" ? "Yellow" : 
                   icon.name === "Default List 1" ? "Green" :
                   icon.name === "Default List 2" ? "Blue" :
                   icon.name === "Default List 3" ? "Pink" : icon.name}
                </div>
              </button>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="upload" className="space-y-4 mt-6">
          <div className="space-y-4">
            <Label htmlFor="file-upload" className="theme-text-primary">
              Upload from your device
            </Label>
            <input
              ref={fileInputRef}
              id="file-upload"
              type="file"
              accept="image/*"
              onChange={handleCustomImageUpload}
              className="hidden"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              variant="outline"
              className="w-full theme-border theme-text-primary hover:theme-bg-hover"
            >
              <Upload className="w-4 h-4 mr-2" />
              Choose File
            </Button>
            {customImageUrl && customImageUrl.startsWith('data:') && (
              <div className="mt-4">
                <img
                  src={customImageUrl}
                  alt="Preview"
                  className="w-24 h-24 object-cover rounded-lg mx-auto"
                />
              </div>
            )}
          </div>
        </TabsContent>

      </Tabs>
    </Card>
  )
}