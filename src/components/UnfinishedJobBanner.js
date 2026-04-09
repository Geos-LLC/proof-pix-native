import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import { getMostRecentUnfinishedJob } from '../services/jobReminderService';
import { logEvent } from '../utils/analytics';

export default function UnfinishedJobBanner({ onPress, refreshKey }) {
  const { t } = useTranslation();
  const [job, setJob] = useState(null);

  useEffect(() => {
    checkUnfinished();
  }, [refreshKey]);

  const checkUnfinished = async () => {
    const result = await getMostRecentUnfinishedJob();
    if (result) {
      setJob(result);
      logEvent('unfinished_job_banner_shown', { total_unfinished: result.totalUnfinished });
    } else {
      setJob(null);
    }
  };

  if (!job) return null;

  const text = job.totalUnfinished > 1
    ? t('home.unfinishedMultiple', { count: job.totalUnfinished, defaultValue: `You have ${job.totalUnfinished} unfinished projects` })
    : t('home.unfinishedSingle', { room: job.room, defaultValue: `You still have an unfinished before/after in ${job.room}` });

  return (
    <TouchableOpacity
      style={styles.banner}
      onPress={() => {
        logEvent('unfinished_job_banner_tapped');
        if (onPress) onPress(job);
      }}
      activeOpacity={0.8}
    >
      <Ionicons name="alert-circle-outline" size={20} color={COLORS.PRIMARY} />
      <Text style={styles.text} numberOfLines={2}>{text}</Text>
      <View style={styles.cta}>
        <Text style={styles.ctaText}>
          {t('home.finishNow', { defaultValue: 'Finish' })}
        </Text>
        <Ionicons name="arrow-forward" size={14} color="#000" />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(242, 195, 27, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(242, 195, 27, 0.25)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  text: {
    flex: 1,
    fontSize: 13,
    color: '#ccc',
    fontFamily: FONTS.REGULAR,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.PRIMARY,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  ctaText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#000',
    fontFamily: FONTS.BOLD,
  },
});
