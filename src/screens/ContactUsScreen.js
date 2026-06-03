/**
 * Contact Us Screen
 * Full screen page for users to submit feedback or inquiries
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import enterpriseContactService from '../services/enterpriseContactService';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../hooks/useRTL';

export default function ContactUsScreen() {
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { isRTL, textStyle, inputStyle } = useRTL();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    description: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      Alert.alert('Error', 'Please enter your name');
      return;
    }
    if (!formData.email.trim()) {
      Alert.alert('Error', 'Please enter your email address');
      return;
    }
    if (!formData.email.includes('@')) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    setIsSubmitting(true);

    try {
      await enterpriseContactService.sendRequest(formData);

      // Show success message
      Alert.alert(
        'Success',
        'Your message has been sent successfully. We\'ll get back to you soon!',
        [
          {
            text: 'OK',
            onPress: () => {
              setFormData({
                name: '',
                email: '',
                phone: '',
                description: '',
              });
              navigation.goBack();
            },
          },
        ]
      );
    } catch (error) {
      let errorMessage = 'Failed to send your message. Please try again.';

      if (error.message === 'NAME_REQUIRED') {
        errorMessage = 'Please enter your name';
      } else if (error.message === 'EMAIL_REQUIRED') {
        errorMessage = 'Please enter your email address';
      } else if (error.message === 'INVALID_EMAIL') {
        errorMessage = 'Please enter a valid email address';
      } else if (error.message === 'EMAIL_NOT_CONFIGURED') {
        errorMessage = 'Email service is not configured. Please contact support directly at info@geos-ai.com';
      }

      Alert.alert('Error', errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <Ionicons name={isRTL ? "arrow-forward" : "arrow-back"} size={24} color={COLORS.TEXT} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('contact.title', { defaultValue: 'Contact us' })}</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Icon Section */}
          <View style={styles.iconContainer}>
            <View style={styles.iconCircle}>
              <Ionicons name="mail" size={40} color="#F9A825" />
            </View>
          </View>

          {/* Heading */}
          <Text style={[styles.heading, textStyle]}>{t('contact.heading', { defaultValue: 'Tell us what you think' })}</Text>

          {/* Description */}
          <Text style={[styles.description, textStyle]}>
            {t('contact.description', { defaultValue: "We'd love to hear your feedback, suggestions or answer any questions you may have." })}
          </Text>

          {/* Form Fields */}
          <View style={styles.formContainer}>
            <View style={styles.inputGroup}>
              <Text style={[styles.label, textStyle]}>{t('contact.nameLabel', { defaultValue: 'Your Name' })}</Text>
              <TextInput
                style={[styles.input, inputStyle]}
                placeholder={t('contact.nameLabel', { defaultValue: 'Your Name' })}
                placeholderTextColor="#999"
                value={formData.name}
                onChangeText={(text) => setFormData({ ...formData, name: text })}
                autoCapitalize="words"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, textStyle]}>{t('contact.emailLabel', { defaultValue: 'Email Address' })}</Text>
              <TextInput
                style={[styles.input, inputStyle]}
                placeholder={t('contact.emailLabel', { defaultValue: 'Email Address' })}
                placeholderTextColor="#999"
                value={formData.email}
                onChangeText={(text) => setFormData({ ...formData, email: text })}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, textStyle]}>{t('contact.phoneLabel', { defaultValue: 'Phone number (Optional)' })}</Text>
              <TextInput
                style={[styles.input, inputStyle]}
                placeholder={t('contact.phoneLabel', { defaultValue: 'Phone number (Optional)' })}
                placeholderTextColor="#999"
                value={formData.phone}
                onChangeText={(text) => setFormData({ ...formData, phone: text })}
                keyboardType="phone-pad"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, textStyle]}>{t('contact.descriptionLabel', { defaultValue: 'Tell us about your needs' })}</Text>
              <TextInput
                style={[styles.input, styles.textArea, inputStyle]}
                placeholder={t('contact.descriptionLabel', { defaultValue: 'Tell us about your needs' })}
                placeholderTextColor="#999"
                value={formData.description}
                onChangeText={(text) => setFormData({ ...formData, description: text })}
                multiline={true}
                numberOfLines={6}
                textAlignVertical="top"
              />
            </View>
          </View>

          {/* Send Request Button */}
          <TouchableOpacity
            style={[styles.sendButton, isSubmitting && styles.disabledButton]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            <Text style={styles.sendButtonText}>
              {isSubmitting ? t('contact.sending', { defaultValue: 'Sending...' }) : t('contact.submit', { defaultValue: 'Send Request' })}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: -0.3,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  iconContainer: {
    alignItems: 'center',
    marginTop: 32,
    marginBottom: 24,
  },
  // Refresh: soft-accent tile (#FFF4C2 per design) replaces the heavier
  // pastel + drop shadow. Cleaner intro icon.
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 22,
    backgroundColor: '#FFF4C2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000000',
    textAlign: 'center',
    marginBottom: 12,
    paddingHorizontal: 20,
    letterSpacing: -0.5,
  },
  description: {
    fontSize: 14,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
    paddingHorizontal: 20,
    letterSpacing: -0.2,
  },
  formContainer: {
    paddingHorizontal: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 8,
    letterSpacing: -0.2,
  },
  // Refresh: input matches design's `pp-surface` field — softer fill
  // (#F4F4F4) + hairline border, radius 14.
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ECECEC',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    backgroundColor: '#F4F4F4',
    color: '#1E1E1E',
    fontFamily: FONTS.ALEXANDRIA,
  },
  textArea: {
    height: 120,
    textAlignVertical: 'top',
    paddingTop: 14,
  },
  // Refresh: primary CTA per design — yellow accent, 52px, radius 16,
  // warm pop-shadow. (Was a dark button — primary CTA convention is yellow.)
  sendButton: {
    backgroundColor: '#F2C31B',
    borderRadius: 16,
    height: 52,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 20,
    marginBottom: 20,
    marginTop: 8,
    shadowColor: '#F2C31B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 6,
  },
  sendButtonText: {
    color: '#1E1E1E',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  disabledButton: {
    opacity: 0.6,
  },
});

