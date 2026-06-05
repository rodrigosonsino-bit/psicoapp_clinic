export function buildSaoPauloDateTimeIso(dateStr: string, timeStr: string): string {
    return `${dateStr.trim()}T${timeStr.trim()}:00-03:00`;
}

export function addMinutesToSaoPauloIso(iso: string, minutes: number): string {
    const date = new Date(iso);
    if (isNaN(date.getTime())) {
        throw new Error(`Invalid ISO date provided to addMinutesToSaoPauloIso: ${iso}`);
    }
    const futureDate = new Date(date.getTime() + minutes * 60 * 1000);
    const tzOffsetMs = -3 * 60 * 60 * 1000;
    const localDate = new Date(futureDate.getTime() + tzOffsetMs);
    return localDate.toISOString().slice(0, 19) + '-03:00';
}

export function getSaoPauloTodayParts(): { year: number; month: number; day: number } {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
    });
    const parts = formatter.formatToParts(now);
    let year = now.getFullYear();
    let month = now.getMonth(); // 0-indexed
    let day = now.getDate();
    
    for (const part of parts) {
        if (part.type === 'year') year = parseInt(part.value, 10);
        if (part.type === 'month') month = parseInt(part.value, 10) - 1; // Convert 1-12 to 0-11
        if (part.type === 'day') day = parseInt(part.value, 10);
    }
    
    return { year, month, day };
}
