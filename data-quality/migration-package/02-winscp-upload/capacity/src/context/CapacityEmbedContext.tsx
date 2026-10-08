import { createContext, useContext } from 'react'

export type CapacityEmbedContextValue = {
  embeddedInMainApp: boolean
  basename: string
}

export const CapacityEmbedContext = createContext<CapacityEmbedContextValue>({
  embeddedInMainApp: false,
  basename: '/',
})

export function useCapacityEmbed(): CapacityEmbedContextValue {
  return useContext(CapacityEmbedContext)
}
