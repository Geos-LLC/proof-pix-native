import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import { useTranslation } from 'react-i18next';

export default function TrialNotificationModal({ visible, notification, onClose, onUpgrade, onCTA, onRefer }) {
  if (!notification) return null;
  const { t } = useTranslation();

  const getTranslationKeys = () => {
    switch (notification.key) {
      case 'day0':
        return {
          title: 'trial.welcomeTitle',
          message: 'trial.welcomeMessage',
        };
      case 'day7_10':
        return {
          title: 'trial.engagementTitle',
          message: 'trial.engagementMessage',
          cta: 'trial.engagementCTA',
        };
      case 'day15':
        return {
          title: 'trial.checkinTitle',
          message: 'trial.checkinMessage',
          cta: 'trial.checkinCTA',
        };
      case 'day22_24':
        return {
          title: 'trial.reminderTitle',
          message: 'trial.reminderMessage',
          cta: 'trial.reminderCTA',
        };
      case 'day27_28':
        return {
          title: 'trial.lastChanceTitle',
          message: 'trial.lastChanceMessage',
          cta: 'trial.lastChanceCTA',
          referralIncentive: 'trial.lastChanceReferralIncentive',
        };
      case 'day30':
        return {
          title: 'trial.expiredTitle',
          message: 'trial.expiredMessage',
          featuresList: 'trial.expiredFeaturesList',
          referralIncentive: 'trial.expiredReferralIncentive',
          cta: 'trial.expiredCTA',
        };
      default:
        return {};
    }
  };

  const translationKeys = getTranslationKeys();

  const localizedTitle = translationKeys.title
    ? t(translationKeys.title, { ...notification, defaultValue: notification.title })
    : notification.title;

  const localizedMessage = translationKeys.message
    ? t(translationKeys.message, { ...notification, defaultValue: notification.message })
    : notification.message;

  const localizedCta = translationKeys.cta
    ? t(translationKeys.cta, { ...notification, defaultValue: notification.cta })
    : notification.cta;

  const localizedFeaturesList = translationKeys.featuresList
    ? t(translationKeys.featuresList, { ...notification, defaultValue: notification.featuresList })
    : notification.featuresList;

  const localizedReferralIncentive = translationKeys.referralIncentive
    ? t(translationKeys.referralIncentive, { ...notification, defaultValue: notification.referralIncentive })
    : notification.referralIncentive;

  const getButtonStyle = () => {
    if (notification.urgent) {
      return [styles.button, styles.urgentButton];
    }
    return [styles.button, styles.primaryButton];
  };

  const getButtonTextStyle = () => {
    if (notification.urgent) {
      return [styles.buttonText, styles.urgentButtonText];
    }
    return [styles.buttonText, styles.primaryButtonText];
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.title}>{localizedTitle}</Text>
          </View>
          
          <View style={styles.content}>
            {notification.key === 'day22_24' ? (
              // Full visual preview of the delete confirmation modal (non-interactive)
              <View style={styles.checkboxPreviewContainer}>
                <Text style={styles.deletePreviewHint}>
                  {t('gallery.deletePreviewHint', {
                    defaultValue: 'When you delete photos, this is what the confirmation will look like:'
                  })}
                </Text>
                <View style={styles.deletePreviewModal}>
                  <Text style={styles.checkboxPreviewTitle}>
                    {t('gallery.deleteProjectTitle', { defaultValue: 'Delete Project' }).toUpperCase()}
                  </Text>
                  <Text style={styles.deletePreviewMessage}>
                    {t('gallery.deleteProjectMessage', {
                      defaultValue: 'Are you sure you want to delete this project and all its photos? This action cannot be undone.'
                    })}
                  </Text>
                  <View style={styles.checkboxPreviewRow}>
                    <View style={[styles.checkboxPreviewBox, styles.checkboxPreviewBoxChecked]}>
                      <Text style={styles.checkboxCheck}>✓</Text>
                    </View>
                    <Text style={styles.checkboxPreviewLabel}>
                      {t('common.deleteFromPhoneStorage', { defaultValue: 'Delete from phone storage' })}
                    </Text>
                  </View>
                  <View style={styles.deletePreviewButtons}>
                    <View style={[styles.deletePreviewButton, styles.deletePreviewCancel]}>
                      <Text style={styles.deletePreviewCancelText}>
                        {t('common.cancel')}
                      </Text>
                    </View>
                    <View style={[styles.deletePreviewButton, styles.deletePreviewDelete]}>
                      <Text style={styles.deletePreviewDeleteText}>
                        {t('common.delete')}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            ) : (
              <>
                <Text style={styles.message}>
                  {localizedMessage}
                  {notification.endDate && (
                    <Text>
                      {' '}
                      {t('trial.endsOnPrefix', { defaultValue: 'Your trial ends on ' })}
                      <Text style={styles.endDate}>{notification.endDate}</Text>.
                    </Text>
                  )}
                </Text>
                {localizedCta && !notification.showUpgrade && (
                  <TouchableOpacity
                    onPress={() => {
                      if (onCTA) {
                        onCTA(notification);
                      } else {
                        onClose();
                      }
                    }}
                    style={styles.ctaButton}
                  >
                    <Text style={styles.cta}>{localizedCta}</Text>
                  </TouchableOpacity>
                )}
                {notification.ctaDescription && (
                  <Text style={styles.ctaDescription}>{notification.ctaDescription}</Text>
                )}
                {localizedFeaturesList && (
                  <Text style={styles.featuresList}>{localizedFeaturesList}</Text>
                )}
                {localizedReferralIncentive && notification.key !== 'day30' && (
                  <Text style={styles.referralIncentive}>{localizedReferralIncentive}</Text>
                )}
                {notification.discountOffer && (
                  <Text style={styles.discountOffer}>
                    {t(`trial.${notification.key}.discountOffer`, {
                      ...notification,
                      defaultValue: notification.discountOffer,
                    })}
                  </Text>
                )}
              </>
            )}
          </View>

          <View style={styles.actions}>
            {notification.showUpgrade ? (
              <>
                {notification.key === 'day30' ? (
                  // Day 30: Upgrade Now, then Referral text, then Refer a Friend, then I'm Good
                  <>
                    <TouchableOpacity
                      style={[styles.button, styles.upgradeButton]}
                      onPress={onUpgrade}
                    >
                      <Text style={[styles.buttonText, styles.upgradeButtonText]}>
                        {(localizedCta || 'Upgrade Now').replace('👉 ', '')}
                      </Text>
                    </TouchableOpacity>
                    {localizedReferralIncentive && (
                      <Text style={styles.referralIncentiveDay30}>{localizedReferralIncentive}</Text>
                    )}
                    <TouchableOpacity
                      style={[styles.button, styles.referButton]}
                      onPress={onRefer || onClose}
                    >
                      <Text style={[styles.buttonText, styles.referButtonText]}>
                        {t('trial.referFriendButton', { defaultValue: 'Refer a Friend' })}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.button, styles.secondaryButton]}
                      onPress={onClose}
                    >
                      <Text style={[styles.buttonText, styles.secondaryButtonText]}>
                        {t('trial.goodButton', { defaultValue: "I'm Good" })}
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : notification.key === 'day27_28' ? (
                  // Day 27-28: Two buttons stacked vertically, then Maybe Later
                  <>
                    <View style={styles.twoButtonRow}>
                      <TouchableOpacity
                        style={[styles.button, styles.upgradeButton]}
                        onPress={onUpgrade}
                      >
                      <Text style={[styles.buttonText, styles.upgradeButtonText]}>
                        {t('trial.upgradeNowButton', { defaultValue: 'Upgrade Now' })}
                      </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.button, styles.referButton]}
                        onPress={onRefer || onClose}
                      >
                        <Text style={[styles.buttonText, styles.referButtonText]}>
                          {t('trial.referFriendButton', { defaultValue: 'Refer a Friend' })}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity
                      style={[styles.button, styles.secondaryButton]}
                      onPress={onClose}
                    >
                      <Text style={[styles.buttonText, styles.secondaryButtonText]}>
                        {t('trial.maybeButton', { defaultValue: 'Maybe Later' })}
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <TouchableOpacity
                      style={getButtonStyle()}
                      onPress={onUpgrade}
                    >
                      <Text style={getButtonTextStyle()}>
                        {(localizedCta || (notification.urgent ? t('trial.upgradeNowButton', { defaultValue: 'Upgrade Now' }) : 'Upgrade')).replace('👉 ', '')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.button, styles.secondaryButton]}
                      onPress={onClose}
                    >
                      <Text style={[styles.buttonText, styles.secondaryButtonText]}>
                        {t('trial.maybeButton', { defaultValue: 'Maybe Later' })}
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
              </>
            ) : (
              <TouchableOpacity
                style={getButtonStyle()}
                onPress={onClose}
              >
                <Text style={getButtonTextStyle()}>
                  {t('trial.gotItButton', { defaultValue: 'Got It' })}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    width: '100%',
    maxWidth: 400,
    overflow: 'hidden',
  },
  header: {
    padding: 20,
    paddingBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.TEXT,
    fontFamily: FONTS.QUICKSAND_BOLD,
    textAlign: 'center',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  message: {
    fontSize: 16,
    color: COLORS.TEXT,
    lineHeight: 24,
    textAlign: 'center',
  },
  endDate: {
    color: '#4CAF50',
    fontWeight: 'bold',
  },
  ctaButton: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#F5F5F5',
    alignSelf: 'center',
  },
  cta: {
    fontSize: 16,
    color: COLORS.PRIMARY,
    fontWeight: '600',
    textAlign: 'center',
  },
  ctaDescription: {
    fontSize: 14,
    color: COLORS.GRAY,
    marginTop: 8,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  checkboxPreviewContainer: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    alignItems: 'center',
  },
  checkboxPreviewTitle: {
    fontSize: 18,
    color: COLORS.TEXT,
    marginBottom: 8,
    textAlign: 'center',
    fontWeight: '700',
  },
  checkboxPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxPreviewBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    marginRight: 10,
    backgroundColor: '#FFFFFF',
  },
  checkboxPreviewBoxChecked: {
    backgroundColor: COLORS.PRIMARY,
  },
  checkboxPreviewLabel: {
    fontSize: 14,
    color: COLORS.TEXT,
    fontWeight: '500',
  },
  checkboxCheck: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  deletePreviewMessage: {
    fontSize: 14,
    color: COLORS.TEXT,
    marginTop: 8,
    marginBottom: 12,
    textAlign: 'center',
  },
  deletePreviewHint: {
    fontSize: 13,
    color: '#777777',
    marginBottom: 10,
    textAlign: 'center',
  },
  deletePreviewModal: {
    width: '90%',
    maxWidth: 260,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    paddingVertical: 12,
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  deletePreviewButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    gap: 12,
  },
  deletePreviewButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  deletePreviewCancel: {
    backgroundColor: '#F5F5F5',
  },
  deletePreviewDelete: {
    backgroundColor: '#FFCDD2',
  },
  deletePreviewCancelText: {
    color: COLORS.TEXT,
    fontWeight: '600',
  },
  deletePreviewDeleteText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  referralIncentive: {
    fontSize: 14,
    color: COLORS.TEXT,
    marginTop: 12,
    textAlign: 'center',
    fontWeight: '500',
    lineHeight: 22,
  },
  referralIncentiveDay30: {
    fontSize: 16,
    color: '#4CAF50',
    marginTop: 12,
    marginBottom: 8,
    textAlign: 'center',
    fontWeight: 'bold',
  },
  featuresList: {
    fontSize: 14,
    color: COLORS.TEXT,
    marginTop: 12,
    textAlign: 'left',
    lineHeight: 22,
  },
  discountOffer: {
    fontSize: 18,
    color: '#4CAF50',
    fontWeight: 'bold',
    marginTop: 12,
    textAlign: 'center',
  },
  prominentButton: {
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  actions: {
    padding: 20,
    paddingTop: 0,
    gap: 12,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: COLORS.PRIMARY,
  },
  urgentButton: {
    backgroundColor: '#FF4444',
  },
  secondaryButton: {
    backgroundColor: '#F5F5F5',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: FONTS.QUICKSAND_BOLD,
  },
  primaryButtonText: {
    color: '#000000',
  },
  urgentButtonText: {
    color: '#FFFFFF',
  },
  secondaryButtonText: {
    color: COLORS.TEXT,
  },
  twoButtonRow: {
    flexDirection: 'column',
    gap: 12,
    width: '100%',
  },
  upgradeButton: {
    backgroundColor: '#FFD700', // Yellow
    width: '100%',
  },
  upgradeButtonText: {
    color: '#000000',
  },
  referButton: {
    backgroundColor: '#4CAF50', // Green
    width: '100%',
  },
  referButtonText: {
    color: '#FFFFFF',
  },
});


