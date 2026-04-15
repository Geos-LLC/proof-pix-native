import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const ERROR_LOG_KEY = 'app-error-logs';
const MAX_LOGS = 500; // Keep last 500 entries (errors + analytics mirror)

// LogHub (Grafana) — stream errors to the central log aggregator so they
// can be viewed from a browser on any machine. Fail silently — local
// AsyncStorage logging is still the source of truth for export.
const LOGHUB_URL = process.env.EXPO_PUBLIC_LOGHUB_URL || 'https://geosloghub-production.up.railway.app';
const LOGHUB_KEY = process.env.EXPO_PUBLIC_LOGHUB_KEY || 'RAILWAY_INGEST_KEY_123';
const APP_VERSION = Constants?.expoConfig?.version || 'unknown';

const sendToLogHub = async (level, message, extra = {}) => {
  try {
    // Keep network work off the hot path
    fetch(`${LOGHUB_URL}/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ingest-key': LOGHUB_KEY,
      },
      body: JSON.stringify({
        service: 'proofpix-native',
        app: 'proofpix',
        env: __DEV__ ? 'dev' : 'prod',
        level,
        message,
        platform: Platform.OS,
        app_version: APP_VERSION,
        timestamp: new Date().toISOString(),
        ...extra,
      }),
    }).catch(() => {});
  } catch (_) {
    // swallow — logging must never crash the app
  }
};

/**
 * Error Logger Service
 * Logs errors to AsyncStorage and provides export functionality
 */

export const logError = async (error, context = {}) => {
  try {
    const errorLog = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      message: error?.message || 'Unknown error',
      stack: error?.stack || '',
      context: {
        screen: context.screen || 'unknown',
        action: context.action || 'unknown',
        userId: context.userId || null,
        ...context
      },
      deviceInfo: {
        // Add device info if needed
        platform: 'mobile'
      }
    };

    // Get existing logs
    const existingLogs = await getErrorLogs();

    // Add new log and keep only recent ones
    const updatedLogs = [errorLog, ...existingLogs].slice(0, MAX_LOGS);

    // Save to AsyncStorage
    await AsyncStorage.setItem(ERROR_LOG_KEY, JSON.stringify(updatedLogs));

    // Stream to LogHub / Grafana (fire-and-forget)
    sendToLogHub('error', errorLog.message, {
      stack: errorLog.stack,
      screen: errorLog.context.screen,
      action: errorLog.context.action,
      is_fatal: !!errorLog.context.isFatal,
    });

    if (__DEV__) {
      console.error('[errorLogger]', errorLog.message, errorLog.context);
    }

    return errorLog;
  } catch (loggingError) {
  }
};

/**
 * Get all error logs
 */
export const getErrorLogs = async () => {
  try {
    const logs = await AsyncStorage.getItem(ERROR_LOG_KEY);
    return logs ? JSON.parse(logs) : [];
  } catch (error) {
    return [];
  }
};

/**
 * Clear all error logs
 */
export const clearErrorLogs = async () => {
  try {
    await AsyncStorage.removeItem(ERROR_LOG_KEY);
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Export error logs as JSON file
 */
export const exportErrorLogs = async () => {
  try {
    const logs = await getErrorLogs();

    if (logs.length === 0) {
      return { success: false, message: 'No error logs to export' };
    }

    const fileName = `proofpix-errors-${Date.now()}.json`;
    const fileUri = `${FileSystem.documentDirectory}${fileName}`;

    await FileSystem.writeAsStringAsync(
      fileUri,
      JSON.stringify(logs, null, 2),
      { encoding: FileSystem.EncodingType.UTF8 }
    );

    return {
      success: true,
      uri: fileUri,
      fileName,
      logsCount: logs.length
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

/**
 * Get error logs as formatted text
 */
export const getErrorLogsAsText = async () => {
  try {
    const logs = await getErrorLogs();

    if (logs.length === 0) {
      return 'No error logs available';
    }

    return logs.map(log => {
      return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Error ID: ${log.id}
Time: ${log.timestamp}
Screen: ${log.context.screen}
Action: ${log.context.action}

Message: ${log.message}

Stack Trace:
${log.stack}

Context:
${JSON.stringify(log.context, null, 2)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      `.trim();
    }).join('\n\n');
  } catch (error) {
    return 'Failed to format error logs';
  }
};

/**
 * Get error statistics
 */
export const getErrorStats = async () => {
  try {
    const logs = await getErrorLogs();

    const stats = {
      total: logs.length,
      byScreen: {},
      byAction: {},
      recent24h: 0,
      mostCommonError: null
    };

    const now = new Date();
    const errorCounts = {};

    logs.forEach(log => {
      // Count by screen
      stats.byScreen[log.context.screen] = (stats.byScreen[log.context.screen] || 0) + 1;

      // Count by action
      stats.byAction[log.context.action] = (stats.byAction[log.context.action] || 0) + 1;

      // Count recent errors
      const logDate = new Date(log.timestamp);
      const hoursDiff = (now - logDate) / (1000 * 60 * 60);
      if (hoursDiff < 24) {
        stats.recent24h++;
      }

      // Count error messages
      errorCounts[log.message] = (errorCounts[log.message] || 0) + 1;
    });

    // Find most common error
    const mostCommon = Object.entries(errorCounts).sort((a, b) => b[1] - a[1])[0];
    if (mostCommon) {
      stats.mostCommonError = {
        message: mostCommon[0],
        count: mostCommon[1]
      };
    }

    return stats;
  } catch (error) {
    return null;
  }
};

// Tag map: route messages with these prefixes through errorLogger.
// Anything else stays in console only (avoid spamming the log file with
// info/debug noise).
const CAPTURE_TAG_PATTERNS = [
  /^\[IAP\b/,
  /^\[Analytics\b/i,
  /^\[Firebase\b/i,
  /^\[ADMIN\b/,
  /^\[PROXY\b/,
  /^\[SETTINGS\b/,
  /^\[PhotoContext\b/,
  /^\[BackgroundUpload\b/i,
  /^\[errorLogger\b/,
];

const stringifyArg = (arg) => {
  if (arg == null) return String(arg);
  if (arg instanceof Error) return `${arg.message}\n${arg.stack || ''}`;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
};

const shouldCapture = (firstArg) => {
  if (typeof firstArg !== 'string') return false;
  return CAPTURE_TAG_PATTERNS.some((re) => re.test(firstArg));
};

let consolePatched = false;
const patchConsole = () => {
  if (consolePatched) return;
  consolePatched = true;
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);

  console.error = (...args) => {
    origError(...args);
    if (shouldCapture(args[0])) {
      const message = args.map(stringifyArg).join(' ');
      // Pick stack from the first Error arg if present
      const errArg = args.find((a) => a instanceof Error);
      logError(errArg || new Error(message), {
        screen: 'console',
        action: 'console.error',
        tag: typeof args[0] === 'string' ? args[0].split(']')[0] + ']' : '',
      });
    }
  };

  console.warn = (...args) => {
    origWarn(...args);
    if (shouldCapture(args[0])) {
      const message = args.map(stringifyArg).join(' ');
      const errArg = args.find((a) => a instanceof Error);
      logError(errArg || new Error(message), {
        screen: 'console',
        action: 'console.warn',
        tag: typeof args[0] === 'string' ? args[0].split(']')[0] + ']' : '',
      });
    }
  };
};

/**
 * Global error handler wrapper — catches every uncaught JS error,
 * unhandled promise rejection, AND tagged console.error / console.warn
 * calls (e.g., [IAP], [Analytics], [Firebase]). Logs to AsyncStorage +
 * LogHub.
 */
export const setupGlobalErrorHandler = () => {
  try {
    // Uncaught JS errors
    if (typeof ErrorUtils !== 'undefined' && ErrorUtils?.getGlobalHandler) {
      const originalHandler = ErrorUtils.getGlobalHandler();
      ErrorUtils.setGlobalHandler(async (error, isFatal) => {
        try {
          await logError(error, {
            screen: 'global',
            action: 'uncaught_error',
            isFatal,
          });
        } catch (_) {}
        if (originalHandler) originalHandler(error, isFatal);
      });
    }

    // Unhandled promise rejections
    try {
      const tracking = require('promise/setimmediate/rejection-tracking');
      tracking.enable({
        allRejections: true,
        onUnhandled: (id, error) => {
          logError(error || new Error(`Unhandled rejection (id ${id})`), {
            screen: 'global',
            action: 'unhandled_promise_rejection',
          });
        },
        onHandled: () => {},
      });
    } catch (rejectionErr) {
      // promise/setimmediate not always available — skip silently
    }

    // Tagged console.error / console.warn capture
    patchConsole();
  } catch (setupErr) {
    console.warn('[errorLogger] Failed to install global handler:', setupErr?.message);
  }
};
