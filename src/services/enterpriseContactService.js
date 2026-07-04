/**
 * Enterprise Contact Service
 * Handles sending enterprise plan request emails via EmailJS REST API
 */

// EmailJS configuration from environment variables
const EMAILJS_SERVICE_ID = process.env.EXPO_PUBLIC_EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = process.env.EXPO_PUBLIC_EMAILJS_TEMPLATE_ID;
const EMAILJS_PUBLIC_KEY = process.env.EXPO_PUBLIC_EMAILJS_PUBLIC_KEY;
// Optional autoresponder template — when set, the service fires a
// fire-and-forget second send to the user's own email after the support
// request lands. Create a "Thanks for contacting ProofPix" template in
// the EmailJS dashboard that addresses {{from_name}} at {{to_email}}
// and echoes back {{message}}, then set this env var to its ID. Leave
// the var unset to skip the confirmation entirely (no behavior change).
const EMAILJS_AUTORESPONDER_TEMPLATE_ID = process.env.EXPO_PUBLIC_EMAILJS_AUTORESPONDER_TEMPLATE_ID;
// Optional separate service for the autoresponder — useful when the
// confirmation needs to come from a different "From" address than
// support's. e.g. support@geos-ai.com handles triage but the user-facing
// receipt should look like it comes from georgiy@proofpix.app. Falls
// back to EMAILJS_SERVICE_ID when unset so the autoresponder reuses the
// support service.
const EMAILJS_AUTORESPONDER_SERVICE_ID = process.env.EXPO_PUBLIC_EMAILJS_AUTORESPONDER_SERVICE_ID;

class EnterpriseContactService {
  /**
   * Send enterprise plan request email
   * @param {Object} formData - Form data
   * @param {string} formData.name - Customer's name
   * @param {string} formData.email - Customer's email
   * @param {string} formData.phone - Customer's phone (optional)
   * @param {string} formData.description - Request description (optional)
   * @returns {Promise<boolean>} - True if email sent successfully
   */
  async sendRequest(formData) {
    const { name, email, phone, description } = formData;

    // Validate required fields
    if (!name || !name.trim()) {
      throw new Error('NAME_REQUIRED');
    }
    if (!email || !email.trim()) {
      throw new Error('EMAIL_REQUIRED');
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      throw new Error('INVALID_EMAIL');
    }

    if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY) {
      console.error('[EnterpriseContact] Missing EmailJS configuration. Set EXPO_PUBLIC_EMAILJS_SERVICE_ID, EXPO_PUBLIC_EMAILJS_TEMPLATE_ID, and EXPO_PUBLIC_EMAILJS_PUBLIC_KEY in your .env file.');
      throw new Error('EMAIL_NOT_CONFIGURED');
    }

    try {
      const templateParams = {
        from_name: name.trim(),
        from_email: email.trim(),
        phone: phone?.trim() || 'Not provided',
        message: description?.trim() || 'No description provided',
        to_email: 'info@geos-ai.com',
      };

      // Log configuration for debugging
      console.log('[EnterpriseContact] EmailJS Config:', {
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        public_key: EMAILJS_PUBLIC_KEY,
        has_service_id: !!EMAILJS_SERVICE_ID,
        has_template_id: !!EMAILJS_TEMPLATE_ID,
        has_public_key: !!EMAILJS_PUBLIC_KEY,
      });
      console.log('[EnterpriseContact] Template params:', templateParams);

      const requestBody = {
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        template_params: templateParams,
      };

      console.log('[EnterpriseContact] Request body:', JSON.stringify(requestBody, null, 2));

      // Use EmailJS REST API directly to avoid SDK browser restrictions
      const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost',
        },
        body: JSON.stringify(requestBody),
      });

      console.log('[EnterpriseContact] Response status:', response.status);
      console.log('[EnterpriseContact] Response headers:', JSON.stringify(Object.fromEntries(response.headers.entries())));

      const responseText = await response.text();
      console.log('[EnterpriseContact] Response body:', responseText);

      if (!response.ok) {
        console.error('[EnterpriseContact] EmailJS API error:', response.status, responseText);
        throw new Error('SEND_FAILED');
      }

      // Tagged success log — captured by the FixPrompt allowlist in
      // App.js so a successful in-app send produces a positive Loki
      // signal instead of silence. Includes the sender email + name so
      // we can correlate which user sent which message when triaging in
      // FixPrompt; phone only as a presence flag (no number — keeps the
      // log compact and avoids leaking a callback PII into the log
      // stream unless support actually needs to reach back).
      console.warn('[EnterpriseContact] send ok', JSON.stringify({
        from_email: email.trim(),
        from_name: name.trim(),
        hasPhone: !!(phone && String(phone).trim()),
        descriptionLen: (description || '').length,
      }));

      // Fire-and-forget autoresponder: sends a confirmation copy to the
      // user's own email using a separate template. Deliberately NOT
      // awaited — the primary support send already succeeded, so the
      // user's in-app "Thanks!" alert fires regardless of whether the
      // confirmation lands. We log success/failure for diagnostics but
      // don't surface autoresponder failures to the user (they got
      // through to support; that's the contract).
      if (EMAILJS_AUTORESPONDER_TEMPLATE_ID) {
        this.sendAutoresponder({
          name: name.trim(),
          email: email.trim(),
          message: description?.trim() || '',
        }).catch((e) => {
          console.warn('[EnterpriseContact] autoresponder failed', String(e?.message || e));
        });
      }

      return true;
    } catch (error) {
      console.error('[EnterpriseContact] EmailJS error:', error);
      throw new Error('SEND_FAILED');
    }
  }

  // Confirmation email to the user. Uses a separate EmailJS template
  // configured for the recipient (the user), not for support.
  //
  // Template (template_9bcr8vi) variable contract:
  //   Settings → To Email   : {{to_email}}
  //   Settings → From Name  : {{from_name}}
  //   Body                  : {{name}}, {{title}}
  // We send every variant the template might use ({to_name,name}, {title,
  // subject,message}) so a template-side rename doesn't silently render an
  // empty greeting. `title` gets the first line of the user's message so
  // the body reads "received your request: \"<their words>\"".
  async sendAutoresponder({ name, email, message }) {
    if (!EMAILJS_SERVICE_ID || !EMAILJS_AUTORESPONDER_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY) {
      throw new Error('AUTORESPONDER_NOT_CONFIGURED');
    }
    // Derive a short request title from the user's message. Take the
    // first non-empty line, strip the bracketed topic prefix that
    // HelpSupportScreen prepends (e.g. "[Question] ProofPix in-app
    // feedback"), and cap at 80 chars so the email subject/title line
    // stays readable.
    const rawLine = String(message || '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) || 'your support request';
    const title = rawLine
      .replace(/^\[[^\]]+\]\s*ProofPix in-app feedback$/i, 'your support request')
      .slice(0, 80);

    const templateParams = {
      // Template "To Email" field
      to_email: email,
      // Template body greeting — template uses {{name}}; alias to_name
      // is kept in case a future template rename swaps to {{to_name}}.
      name,
      to_name: name,
      // Template body subject/title — template uses {{title}}; title +
      // subject + message all populated so a rename to any of them still
      // renders something meaningful.
      title,
      subject: title,
      message,
      // Sender identity surfaced by EmailJS to the SMTP relay
      from_name: 'ProofPix Support',
      from_email: 'support@proofpix.app',
    };
    // Use the dedicated autoresponder service when configured (different
    // From identity than support), otherwise reuse the support service.
    const serviceIdForAutoresponder = EMAILJS_AUTORESPONDER_SERVICE_ID || EMAILJS_SERVICE_ID;
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost' },
      body: JSON.stringify({
        service_id: serviceIdForAutoresponder,
        template_id: EMAILJS_AUTORESPONDER_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        template_params: templateParams,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`autoresponder ${response.status}: ${body.slice(0, 200)}`);
    }
    console.warn('[EnterpriseContact] autoresponder sent', JSON.stringify({
      to_email: email,
      service_id: serviceIdForAutoresponder,
    }));
    return true;
  }
}

export default new EnterpriseContactService();
