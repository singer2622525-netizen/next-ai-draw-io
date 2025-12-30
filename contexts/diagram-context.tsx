"use client"

import type React from "react"
import { createContext, useContext, useEffect, useRef, useState } from "react"
import type { DrawIoEmbedRef } from "react-drawio"
import { STORAGE_DIAGRAM_XML_KEY } from "@/components/chat-panel"
import type { ExportFormat } from "@/components/save-dialog"
import { getApiEndpoint } from "@/lib/base-path"
import { extractDiagramXML, validateAndFixXml } from "../lib/utils"

interface DiagramContextType {
    chartXML: string
    latestSvg: string
    diagramHistory: { svg: string; xml: string }[]
    loadDiagram: (chart: string, skipValidation?: boolean) => string | null
    handleExport: () => void
    handleExportWithoutHistory: () => void
    resolverRef: React.Ref<((value: string) => void) | null>
    drawioRef: React.Ref<DrawIoEmbedRef | null>
    handleDiagramExport: (data: any) => void
    clearDiagram: () => void
    saveDiagramToFile: (
        filename: string,
        format: ExportFormat,
        sessionId?: string,
        usePathSelector?: boolean,
    ) => void | Promise<void>
    saveDiagramToStorage: () => Promise<void>
    isDrawioReady: boolean
    onDrawioLoad: () => void
    resetDrawioReady: () => void
    showSaveDialog: boolean
    setShowSaveDialog: (show: boolean) => void
    onSaveSuccess?: () => void
    setOnSaveSuccess: (callback: (() => void) | undefined) => void
}

const DiagramContext = createContext<DiagramContextType | undefined>(undefined)

export function DiagramProvider({ children }: { children: React.ReactNode }) {
    const [chartXML, setChartXML] = useState<string>("")
    const [latestSvg, setLatestSvg] = useState<string>("")
    const [diagramHistory, setDiagramHistory] = useState<
        { svg: string; xml: string }[]
    >([])
    const [isDrawioReady, setIsDrawioReady] = useState(false)
    const [canSaveDiagram, setCanSaveDiagram] = useState(false)
    const [showSaveDialog, setShowSaveDialog] = useState(false)
    const [onSaveSuccess, setOnSaveSuccess] = useState<
        (() => void) | undefined
    >(undefined)
    const hasCalledOnLoadRef = useRef(false)
    const drawioRef = useRef<DrawIoEmbedRef | null>(null)
    const resolverRef = useRef<((value: string) => void) | null>(null)
    // Track if we're expecting an export for history (user-initiated)
    const expectHistoryExportRef = useRef<boolean>(false)
    // Track if diagram has been restored from localStorage
    const hasDiagramRestoredRef = useRef<boolean>(false)

    const onDrawioLoad = () => {
        // Only set ready state once to prevent infinite loops
        if (hasCalledOnLoadRef.current) return
        hasCalledOnLoadRef.current = true
        // console.log("[DiagramContext] DrawIO loaded, setting ready state")
        setIsDrawioReady(true)
    }

    const resetDrawioReady = () => {
        // console.log("[DiagramContext] Resetting DrawIO ready state")
        hasCalledOnLoadRef.current = false
        setIsDrawioReady(false)
    }

    // Restore diagram XML when DrawIO becomes ready
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadDiagram uses refs internally and is stable
    useEffect(() => {
        // Reset restore flag when DrawIO is not ready (e.g., theme/UI change remounts it)
        if (!isDrawioReady) {
            hasDiagramRestoredRef.current = false
            setCanSaveDiagram(false)
            return
        }
        if (hasDiagramRestoredRef.current) return
        hasDiagramRestoredRef.current = true

        try {
            const savedDiagramXml = localStorage.getItem(
                STORAGE_DIAGRAM_XML_KEY,
            )
            if (savedDiagramXml) {
                // Skip validation for trusted saved diagrams
                loadDiagram(savedDiagramXml, true)
            }
        } catch (error) {
            console.error("Failed to restore diagram from localStorage:", error)
        }

        // Allow saving after restore is complete
        setTimeout(() => {
            setCanSaveDiagram(true)
        }, 500)
    }, [isDrawioReady])

    // Save diagram XML to localStorage whenever it changes (debounced)
    useEffect(() => {
        if (!canSaveDiagram) return
        if (!chartXML || chartXML.length <= 300) return

        const timeoutId = setTimeout(() => {
            localStorage.setItem(STORAGE_DIAGRAM_XML_KEY, chartXML)
        }, 1000)

        return () => clearTimeout(timeoutId)
    }, [chartXML, canSaveDiagram])

    // Track if we're expecting an export for file save (stores raw export data)
    const saveResolverRef = useRef<{
        resolver: ((data: string) => void) | null
        format: ExportFormat | null
    }>({ resolver: null, format: null })

    const handleExport = () => {
        if (drawioRef.current) {
            // Mark that this export should be saved to history
            expectHistoryExportRef.current = true
            drawioRef.current.exportDiagram({
                format: "xmlsvg",
            })
        }
    }

    const handleExportWithoutHistory = () => {
        if (drawioRef.current) {
            // Export without saving to history (for edit_diagram fetching current state)
            drawioRef.current.exportDiagram({
                format: "xmlsvg",
            })
        }
    }

    // Save current diagram to localStorage (used before theme/UI changes)
    const saveDiagramToStorage = async (): Promise<void> => {
        if (!drawioRef.current) return

        try {
            const currentXml = await Promise.race([
                new Promise<string>((resolve) => {
                    resolverRef.current = resolve
                    drawioRef.current?.exportDiagram({ format: "xmlsvg" })
                }),
                new Promise<string>((_, reject) =>
                    setTimeout(() => reject(new Error("Export timeout")), 2000),
                ),
            ])

            // Only save if diagram has meaningful content (not empty template)
            if (currentXml && currentXml.length > 300) {
                localStorage.setItem(STORAGE_DIAGRAM_XML_KEY, currentXml)
            }
        } catch (error) {
            console.error("Failed to save diagram to storage:", error)
        }
    }

    const loadDiagram = (
        chart: string,
        skipValidation?: boolean,
    ): string | null => {
        let xmlToLoad = chart

        // Validate XML structure before loading (unless skipped for internal use)
        if (!skipValidation) {
            const validation = validateAndFixXml(chart)
            if (!validation.valid) {
                console.warn(
                    "[loadDiagram] Validation error:",
                    validation.error,
                )
                return validation.error
            }
            // Use fixed XML if auto-fix was applied
            if (validation.fixed) {
                console.log(
                    "[loadDiagram] Auto-fixed XML issues:",
                    validation.fixes,
                )
                xmlToLoad = validation.fixed
            }
        }

        // Keep chartXML in sync even when diagrams are injected (e.g., display_diagram tool)
        setChartXML(xmlToLoad)

        if (drawioRef.current) {
            drawioRef.current.load({
                xml: xmlToLoad,
            })
        }

        return null
    }

    const handleDiagramExport = (data: any) => {
        // Handle save to file if requested (process raw data before extraction)
        if (saveResolverRef.current.resolver) {
            const format = saveResolverRef.current.format
            saveResolverRef.current.resolver(data.data)
            saveResolverRef.current = { resolver: null, format: null }
            // For non-xmlsvg formats, skip XML extraction as it will fail
            // Only drawio (which uses xmlsvg internally) has the content attribute
            if (format === "png" || format === "svg") {
                return
            }
        }

        const extractedXML = extractDiagramXML(data.data)
        setChartXML(extractedXML)
        setLatestSvg(data.data)

        // Only add to history if this was a user-initiated export
        // Limit to 20 entries to prevent memory leaks during long sessions
        const MAX_HISTORY_SIZE = 20
        if (expectHistoryExportRef.current) {
            setDiagramHistory((prev) => {
                const newHistory = [
                    ...prev,
                    {
                        svg: data.data,
                        xml: extractedXML,
                    },
                ]
                // Keep only the last MAX_HISTORY_SIZE entries (circular buffer)
                return newHistory.slice(-MAX_HISTORY_SIZE)
            })
            expectHistoryExportRef.current = false
        }

        if (resolverRef.current) {
            resolverRef.current(extractedXML)
            resolverRef.current = null
        }
    }

    const clearDiagram = () => {
        const emptyDiagram = `<mxfile><diagram name="Page-1" id="page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`
        // Skip validation for trusted internal template (loadDiagram also sets chartXML)
        loadDiagram(emptyDiagram, true)
        setLatestSvg("")
        setDiagramHistory([])
    }

    const saveDiagramToFile = async (
        filename: string,
        format: ExportFormat,
        sessionId?: string,
        usePathSelector = false,
    ) => {
        if (!drawioRef.current) {
            console.warn("Draw.io editor not ready")
            return
        }

        // Map format to draw.io export format
        const drawioFormat = format === "drawio" ? "xmlsvg" : format

        // Set up the resolver before triggering export
        saveResolverRef.current = {
            resolver: async (exportData: string) => {
                let fileContent: string | Blob
                let mimeType: string
                let extension: string

                if (format === "drawio") {
                    // Extract XML from SVG for .drawio format
                    const xml = extractDiagramXML(exportData)
                    let xmlContent = xml
                    if (!xml.includes("<mxfile")) {
                        xmlContent = `<mxfile><diagram name="Page-1" id="page-1">${xml}</diagram></mxfile>`
                    }
                    fileContent = xmlContent
                    mimeType = "application/xml"
                    extension = ".drawio"

                    // Save to localStorage when user manually saves
                    localStorage.setItem(STORAGE_DIAGRAM_XML_KEY, xmlContent)
                } else if (format === "png") {
                    // PNG data comes as base64 data URL
                    fileContent = exportData
                    mimeType = "image/png"
                    extension = ".png"
                } else {
                    // SVG format
                    fileContent = exportData
                    mimeType = "image/svg+xml"
                    extension = ".svg"
                }

                // Log save event to Langfuse (flags the trace)
                logSaveToLangfuse(filename, format, sessionId)

                // Check if we should use path selector
                if (usePathSelector) {
                    // Try Electron first
                    if (
                        typeof window !== "undefined" &&
                        window.electronAPI?.isElectron
                    ) {
                        try {
                            // Convert fileContent to string if needed
                            let dataToSave: string
                            if (typeof fileContent === "string") {
                                if (fileContent.startsWith("data:")) {
                                    // For PNG, extract base64 data from data URL
                                    const base64Data = fileContent.split(",")[1]
                                    dataToSave = base64Data // Keep as base64 for Electron
                                } else {
                                    dataToSave = fileContent
                                }
                            } else {
                                // Convert Blob to string
                                const arrayBuffer = await (
                                    fileContent as Blob
                                ).arrayBuffer()
                                if (format === "png") {
                                    // For PNG, convert to base64
                                    const bytes = new Uint8Array(arrayBuffer)
                                    const binary = String.fromCharCode(...bytes)
                                    dataToSave = btoa(binary)
                                } else {
                                    dataToSave = new TextDecoder().decode(
                                        arrayBuffer,
                                    )
                                }
                            }

                            // Use Electron save dialog with options
                            const saveOptions = { filename, format }
                            const success = await window.electronAPI.saveFile(
                                dataToSave,
                                saveOptions,
                            )
                            if (success) {
                                // Call save success callback
                                if (onSaveSuccess) {
                                    setTimeout(() => onSaveSuccess(), 500)
                                }
                                return // Successfully saved via Electron
                            }
                        } catch (error) {
                            console.warn("Failed to save via Electron:", error)
                            // Fall through to web file system API or download
                        }
                    }

                    // Try File System Access API (Chrome/Edge)
                    if (
                        typeof window !== "undefined" &&
                        "showSaveFilePicker" in window
                    ) {
                        try {
                            let blob: Blob
                            if (typeof fileContent === "string") {
                                if (fileContent.startsWith("data:")) {
                                    // Convert data URL to blob
                                    const response = await fetch(fileContent)
                                    blob = await response.blob()
                                } else {
                                    blob = new Blob([fileContent], {
                                        type: mimeType,
                                    })
                                }
                            } else {
                                blob = fileContent
                            }

                            const fileHandle = await window.showSaveFilePicker({
                                suggestedName: `${filename}${extension}`,
                                types: [
                                    {
                                        description:
                                            format === "drawio"
                                                ? "Draw.io XML File"
                                                : format === "png"
                                                  ? "PNG Image"
                                                  : "SVG Image",
                                        accept: {
                                            [mimeType]: [extension],
                                        },
                                    },
                                ],
                            })

                            const writable = await fileHandle.createWritable()
                            await writable.write(blob)
                            await writable.close()
                            // Call save success callback
                            if (onSaveSuccess) {
                                setTimeout(() => onSaveSuccess(), 500)
                            }
                            return // Successfully saved via File System Access API
                        } catch (error: unknown) {
                            // User cancelled or error occurred
                            if (
                                error instanceof Error &&
                                error.name !== "AbortError"
                            ) {
                                console.warn(
                                    "Failed to save via File System Access API:",
                                    error,
                                )
                            }
                            // Fall through to default download
                        }
                    }
                }

                // Default: use browser download
                let url: string
                if (
                    typeof fileContent === "string" &&
                    fileContent.startsWith("data:")
                ) {
                    // Already a data URL (PNG)
                    url = fileContent
                } else {
                    const blob =
                        typeof fileContent === "string"
                            ? new Blob([fileContent], { type: mimeType })
                            : fileContent
                    url = URL.createObjectURL(blob)
                }

                const a = document.createElement("a")
                a.href = url
                a.download = `${filename}${extension}`
                document.body.appendChild(a)
                a.click()
                // Check if element is still a child before removing
                if (a.parentNode === document.body) {
                    document.body.removeChild(a)
                }

                // Delay URL revocation to ensure download completes
                if (!url.startsWith("data:")) {
                    setTimeout(() => URL.revokeObjectURL(url), 100)
                }

                // Call save success callback after download starts
                // Note: For browser download, we assume success after triggering download
                if (onSaveSuccess) {
                    setTimeout(() => onSaveSuccess(), 500)
                }
            },
            format,
        }

        // Export diagram - callback will be handled in handleDiagramExport
        drawioRef.current.exportDiagram({ format: drawioFormat })
    }

    // Log save event to Langfuse (just flags the trace, doesn't send content)
    const logSaveToLangfuse = async (
        filename: string,
        format: string,
        sessionId?: string,
    ) => {
        try {
            await fetch(getApiEndpoint("/api/log-save"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filename, format, sessionId }),
            })
        } catch (error) {
            console.warn("Failed to log save to Langfuse:", error)
        }
    }

    return (
        <DiagramContext.Provider
            value={{
                chartXML,
                latestSvg,
                diagramHistory,
                loadDiagram,
                handleExport,
                handleExportWithoutHistory,
                resolverRef,
                drawioRef,
                handleDiagramExport,
                clearDiagram,
                saveDiagramToFile,
                saveDiagramToStorage,
                isDrawioReady,
                onDrawioLoad,
                resetDrawioReady,
                showSaveDialog,
                setShowSaveDialog,
                onSaveSuccess,
                setOnSaveSuccess,
            }}
        >
            {children}
        </DiagramContext.Provider>
    )
}

export function useDiagram() {
    const context = useContext(DiagramContext)
    if (context === undefined) {
        throw new Error("useDiagram must be used within a DiagramProvider")
    }
    return context
}
