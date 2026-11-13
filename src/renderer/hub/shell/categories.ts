import type { InsightCategoryId } from '@shared/types'
import { t } from '@/lib/i18n'

/** Libellés de catégories d'applis, communs à Style et Statistiques. */
export const categoryLabel = (id: InsightCategoryId): string => t(`cat.${id}`)

export const categoryHint = (id: InsightCategoryId): string => t(`cat.${id}.hint`)
