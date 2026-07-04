import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAdmin } from '../context/AdminContext';
import { FONTS } from '../constants/fonts';
import { useTheme } from '../hooks/useTheme';

export default function InviteScreen({ route, navigation }) {
  const { token, sessionId } = route.params || {};
  const { joinTeam } = useAdmin();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const processInvite = async () => {
      // Validate required parameters
      if (!token || !sessionId) {
        setError('This invite link is invalid or incomplete. Please request a new link from your administrator.');
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
          setError(result.error || 'An unknown error occurred while trying to join the team.');
          setIsLoading(false);
        }
      } catch (e) {
        setError('An unexpected error occurred. Please try again.');
        setIsLoading(false);
      }
    };

    processInvite();
  }, [token, sessionId, joinTeam, navigation]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ActivityIndicator size="large" color="#007bff" />
        <Text style={styles.loadingText}>Joining team...</Text>
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

const makeStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: theme.surfaceElevated,
  },
  loadingText: {
    fontFamily: FONTS.ALEXANDRIA,
    marginTop: 10,
    fontSize: 16,
    color: theme.textPrimary,
  },
  errorText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    color: 'red',
  },
});
