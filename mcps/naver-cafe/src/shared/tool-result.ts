export function toolResult(data: Record<string, unknown>, message = JSON.stringify(data)) {
    return {content: [{type: 'text' as const, text: message}], structuredContent: data};
}
