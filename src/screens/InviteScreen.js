import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAdmin } from '../context/AdminContext';
import { FONTS } from '../constants/fonts';

export default function InviteScreen({ route, navigation }) {
  const { token, sessionId } = route.params || {};
  const { joinTeam } = useAdmin();
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const processInvite = async () => {
      // Validate required parameters
      if (!token || !sessionId) {
        setError(t('invite.invalidLinkMessage'));
        setIsLoading(false);
        return;
      }

      try {
        const result = await joinTeam(token, sessionId);
        if (result.success) {
          // Navigate to home screen and reset the stack
          navigation.reset({
            index: 0,
            routes: [{ name: 'Home' }],
          });
        } else {
          setError(result.error || t('invite.unknownError'));
          setIsLoading(false);
        }
      } catch (e) {
        setError(t('invite.unexpectedError'));
        setIsLoading(false);
      }
    };

    processInvite();
  }, [token, sessionId, joinTeam, navigation, t]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ActivityIndicator size="large" color="#007bff" />
        <Text style={styles.loadingText}>{t('invite.joiningTeam')}</Text>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <Text style={styles.errorText}>{error}</Text>
      </SafeAreaView>
    );
  }

  return null; // Should not be reached
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  loadingText: {
    fontFamily: FONTS.ALEXANDRIA,
    marginTop: 10,
    fontSize: 16,
    color: '#333',
  },
  errorText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    color: 'red',
  },
});
