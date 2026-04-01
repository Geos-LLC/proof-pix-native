/**
 * Enterprise Contact Service
 * Handles sending enterprise plan request emails via EmailJS REST API
 */

// EmailJS configuration from environment variables
const EMAILJS_SERVICE_ID = process.env.EXPO_PUBLIC_EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = process.env.EXPO_PUBLIC_EMAILJS_TEMPLATE_ID;
const EMAILJS_PUBLIC_KEY = process.env.EXPO_PUBLIC_EMAILJS_PUBLIC_KEY;

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

      return true;
    } catch (error) {
      console.error('[EnterpriseContact] EmailJS error:', error);
      throw new Error('SEND_FAILED');
    }
  }
}

export default new EnterpriseContactService();
