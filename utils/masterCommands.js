function interpretMasterCommand(command) {
    const normalized = command.trim().toLowerCase();
    if (/\b(delete|erase|clear|reset|restart|stop|shutdown|kill|send|create|update|modify)\b/.test(normalized)) {
        return {
            intent: 'review_required',
            message: 'Grace captured this command for your review. No automated action was taken.'
        };
    }
    if (/\b(operations|incident|corridor|breakdown)\b/.test(normalized)) {
        return {
            intent: 'open_operations',
            message: 'Opening the live operations wall.',
            navigateTo: '/operations.html'
        };
    }
    if (/\b(console|dashboard|dispatch history|invoice)\b/.test(normalized)) {
        return {
            intent: 'open_console',
            message: 'Opening the dispatch console.',
            navigateTo: '/'
        };
    }
    if (/\b(refresh|reload|update)\b/.test(normalized)) {
        return {
            intent: 'refresh_modules',
            message: 'Refreshing module status and live operations data.',
            refresh: true
        };
    }
    if (/\b(status|health|system check)\b/.test(normalized)) {
        return {
            intent: 'system_status',
            message: 'System status is available in the master monitor.'
        };
    }
    return {
        intent: 'review_required',
        message: 'Grace captured this command for your review. No automated action was taken.'
    };
}

module.exports = { interpretMasterCommand };
