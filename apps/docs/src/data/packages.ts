import gitBranchIcon from 'lucide-static/icons/git-branch.svg?raw'
import paletteIcon from 'lucide-static/icons/palette.svg?raw'

export interface PackageMeta {
  description: string
  iconSvg: string
  id: string
}

export const packageMetaByLabel: Record<string, PackageMeta> = {
  theme: {
    id: 'theme',
    description: 'Admin UI styles, palettes & fields',
    iconSvg: paletteIcon
  },
  path: {
    id: 'path',
    description: 'Stored URL paths & 1-query lookups',
    iconSvg: gitBranchIcon
  }
}
