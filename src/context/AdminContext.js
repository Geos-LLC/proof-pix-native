import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import googleAuthService from '../services/googleAuthService';
import proxyService from '../services/proxyService';
import { useSettings } from './SettingsContext';
import { hasFeature, FEATURES } from '../constants/featurePermissions';

const STORAGE_KEYS = {
  ADMIN_FOLDER_ID: '@admin_folder_id',
  ADMIN_INVITE_TOKENS: '@admin_invite_tokens',
  ADMIN_PLAN_LIMIT: '@admin_plan_limit',
  ADMIN_USER_MODE: '@admin_user_mode',
  TEAM_MEMBER_INFO: '@team_member_info', // For team members
  PROXY_SESSION_ID: '@proxy_session_id', // Proxy server session ID
  TEAM_NAME: '@team_name', // Team name for admin
  STORED_INDIVIDUAL_PLAN: '@stored_individual_plan', // Store individual plan when switching to team mode
  STORED_INDIVIDUAL_MODE: '@stored_individual_mode', // Store individual mode (individual/admin) when switching to team mode
  CONNECTED_ACCOUNTS: '@admin_connected_accounts', // Persist multiple connected admin accounts
};

const GOOGLE_USER_INFO_KEY = '@admin_user_info';

const AdminContext = createContext();

/**
 * Admin Context Provider
 * Manages admin-specific state for Google Drive integration
 */
export function AdminProvider({ children }) {
  const settingsContext = useSettings();
  const { updateUserPlan, userPlan: currentUserPlan } = settingsContext;
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userInfo, setUserInfo] = useState(null);
  const [folderId, setFolderId] = useState(null);
  const [inviteTokens, setInviteTokens] = useState([]);
  const [planLimit, setPlanLimit] = useState(5); // Default plan limit
  const [isLoading, setIsLoading] = useState(true);
  const [userMode, setUserMode] = useState(null); // 'individual', 'admin', or 'team_member'
  const [teamInfo, setTeamInfo] = useState(null);
  const [proxySessionId, setProxySessionId] = useState(null); // Proxy server session ID
  const [isInitializingProxy, setIsInitializingProxy] = useState(false); // Guard to prevent concurrent initialization
  const [teamName, setTeamName] = useState('');
  const [connectedAccounts, setConnectedAccounts] = useState([]);
  const connectedAccountsRef = useRef([]);

  const persistConnectedAccounts = async (accounts) => {
    try {
      if (!accounts || accounts.length === 0) {
        await AsyncStorage.removeItem(STORAGE_KEYS.CONNECTED_ACCOUNTS);
      } else {
        await AsyncStorage.setItem(STORAGE_KEYS.CONNECTED_ACCOUNTS, JSON.stringify(accounts));
      }
    } catch (error) {
      console.warn('[ADMIN] Failed to persist connected accounts:', error?.message || error);
    }
  };

  const setConnectedAccountsState = async (accounts, { persist = true } = {}) => {
    setConnectedAccounts(accounts);
    connectedAccountsRef.current = accounts;
    if (persist) {
      await persistConnectedAccounts(accounts);
    }
  };

  const getActiveAccount = (accountsList = connectedAccounts) =>
    accountsList.find((account) => account?.isActive);

  const applyAccountState = async (account, options = {}) => {
    const { syncStorage = true } = options;

    if (account) {
      const normalizedUserInfo = account.userInfo || {
        id: account.id,
        email: account.email,
        name: account.name,
        photo: account.photo,
        givenName: account.userInfo?.givenName || account.name,
      };
      const nextPlanLimit = Number.isFinite(account.planLimit)
        ? account.planLimit
        : Number.isFinite(Number(account.planLimit))
          ? Number(account.planLimit)
          : 5;

      setIsAuthenticated(true);
      setUserInfo(normalizedUserInfo);
      setUserMode(account.userMode || 'admin');
      setFolderId(account.folderId || null);
      setInviteTokens(account.inviteTokens || []);
      setPlanLimit(nextPlanLimit);
      setProxySessionId(account.proxySessionId || null);
      setTeamName(account.teamName || '');
      setTeamInfo(account.teamInfo || null);
    } else {
      setIsAuthenticated(false);
      setUserInfo(null);
      setUserMode(null);
      setFolderId(null);
      setInviteTokens([]);
      setPlanLimit(5);
      setProxySessionId(null);
      setTeamName('');
      setTeamInfo(null);
    }

    if (!syncStorage) {
      return;
    }

    try {
      if (account) {
        if (account.userInfo) {
          await AsyncStorage.setItem(GOOGLE_USER_INFO_KEY, JSON.stringify(account.userInfo));
        }

        await AsyncStorage.setItem(
          STORAGE_KEYS.ADMIN_USER_MODE,
          account.userMode || 'admin'
        );

        if (account.folderId) {
          await AsyncStorage.setItem(STORAGE_KEYS.ADMIN_FOLDER_ID, account.folderId);
        } else {
          await AsyncStorage.removeItem(STORAGE_KEYS.ADMIN_FOLDER_ID);
        }

        await AsyncStorage.setItem(
          STORAGE_KEYS.ADMIN_INVITE_TOKENS,
          JSON.stringify(account.inviteTokens || [])
        );

        await AsyncStorage.setItem(
          STORAGE_KEYS.ADMIN_PLAN_LIMIT,
          String(account.planLimit ?? 5)
        );

        if (account.proxySessionId) {
          await AsyncStorage.setItem(STORAGE_KEYS.PROXY_SESSION_ID, account.proxySessionId);
        } else {
          await AsyncStorage.removeItem(STORAGE_KEYS.PROXY_SESSION_ID);
        }

        if (account.teamName) {
          await AsyncStorage.setItem(STORAGE_KEYS.TEAM_NAME, account.teamName);
        } else {
          await AsyncStorage.removeItem(STORAGE_KEYS.TEAM_NAME);
        }

        if (account.teamInfo) {
          await AsyncStorage.setItem(
            STORAGE_KEYS.TEAM_MEMBER_INFO,
            JSON.stringify(account.teamInfo)
          );
        } else {
          await AsyncStorage.removeItem(STORAGE_KEYS.TEAM_MEMBER_INFO);
        }
      } else {
        await AsyncStorage.multiRemove([
          GOOGLE_USER_INFO_KEY,
          STORAGE_KEYS.ADMIN_USER_MODE,
          STORAGE_KEYS.ADMIN_FOLDER_ID,
          STORAGE_KEYS.ADMIN_INVITE_TOKENS,
          STORAGE_KEYS.ADMIN_PLAN_LIMIT,
          STORAGE_KEYS.PROXY_SESSION_ID,
          STORAGE_KEYS.TEAM_NAME,
          STORAGE_KEYS.TEAM_MEMBER_INFO,
        ]);
      }
    } catch (error) {
      console.warn('[ADMIN] Failed to synchronise storage for account state:', error?.message || error);
    }
  };

  const upsertConnectedAccount = async (user, overrides = {}) => {
    if (!user?.id) {
      return null;
    }

    const now = Date.now();
    const prevAccounts = connectedAccountsRef.current || [];
    // Use feature permissions system instead of hardcoded check
    const allowMultipleAccounts = hasFeature(FEATURES.MULTIPLE_CLOUD_ACCOUNTS, currentUserPlan);
    const accountType = overrides.accountType || 'google'; // 'google' or 'dropbox'
    
    // Normalize accountType for old accounts that might not have it set
    const normalizedPrevAccounts = prevAccounts.map(account => ({
      ...account,
      accountType: account.accountType || 'google', // Default old accounts to 'google'
    }));
    
    // Use both id and type to uniquely identify accounts (same email can be Google and Dropbox)
    // Also handle case where old accounts don't have accountType - treat them as 'google'
    const existing = normalizedPrevAccounts.find((account) => {
      const accType = account.accountType || 'google';
      return account.id === user.id && accType === accountType;
    });
    const rawPlanLimit = overrides.planLimit ?? existing?.planLimit ?? 5;
    const normalizedPlanLimit = Number.isFinite(rawPlanLimit)
      ? rawPlanLimit
      : Number.isFinite(Number(rawPlanLimit))
      ? Number(rawPlanLimit)
      : 5;

    const updatedAccount = {
      ...(existing || {}),
      ...overrides,
      id: user.id,
      email: user.email,
      name: user.name || user.givenName || existing?.name || '',
      photo: user.photo || existing?.photo || null,
      accountType: accountType, // 'google' or 'dropbox'
      userInfo: {
        ...(existing?.userInfo || {}),
        ...user,
      },
      isActive: true,
      lastConnectedAt: now,
      folderId: overrides.folderId ?? existing?.folderId ?? null,
      inviteTokens: overrides.inviteTokens ?? existing?.inviteTokens ?? [],
      planLimit: normalizedPlanLimit,
      proxySessionId: overrides.proxySessionId ?? existing?.proxySessionId ?? null,
      teamName: overrides.teamName ?? existing?.teamName ?? '',
      userMode: overrides.userMode ?? existing?.userMode ?? 'admin',
      teamInfo: overrides.teamInfo ?? existing?.teamInfo ?? null,
    };

    let updatedList;
    if (allowMultipleAccounts) {
      // Remove duplicates: filter out accounts with same id AND accountType
      // Also ensure all accounts have accountType set
      const deduplicatedAccounts = normalizedPrevAccounts
        .filter((account) => {
          const accType = account.accountType || 'google';
          return !(account.id === user.id && accType === accountType);
        })
        .map((account) => ({
          ...account,
          accountType: account.accountType || 'google', // Ensure accountType is set
          isActive: false,
        }));
      
      updatedList = [updatedAccount, ...deduplicatedAccounts];
    } else {
      updatedList = [updatedAccount];
    }

    console.log('[ADMIN] Adding/updating connected account:', user.id);
    await setConnectedAccountsState(updatedList);
    console.log(
      '[ADMIN] Connected accounts after add:',
      JSON.stringify(
        updatedList.map(({ id, email, name, photo, isActive }) => ({
          id,
          email,
          name,
          photo,
          isActive,
        }))
      )
    );
    await applyAccountState(updatedAccount, { syncStorage: true });
    return updatedAccount;
  };

  const updateActiveAccount = async (updates = {}) => {
    const prevAccounts = connectedAccountsRef.current || [];
    const allowMultipleAccounts = hasFeature(FEATURES.MULTIPLE_CLOUD_ACCOUNTS, currentUserPlan);
    if (!prevAccounts.length) {
      return null;
    }

    let updatedAccount = null;
    const updatedList = prevAccounts.map((account, index) => {
      if (allowMultipleAccounts) {
        if (account.isActive) {
          updatedAccount = { ...account, ...updates };
          return updatedAccount;
        }
        return account;
      }

      if (index === 0) {
        updatedAccount = { ...account, ...updates, isActive: true };
        return updatedAccount;
      }
      return { ...account, isActive: false };
    });

    if (updatedAccount) {
      await setConnectedAccountsState(updatedList);
    }

    return updatedAccount;
  };

  const activateConnectedAccount = async (accountId, accountType = 'google') => {
    const prevAccounts = connectedAccountsRef.current || [];
    const accountToActivate = prevAccounts.find(
      (account) => account.id === accountId && account.accountType === accountType
    );

    if (!accountToActivate) {
      console.warn('[ADMIN] Account not found for activation:', accountId, accountType);
      return null;
    }

    const updatedList = prevAccounts.map((account) => ({
      ...account,
      isActive: account.id === accountId && account.accountType === accountType,
    }));

    await setConnectedAccountsState(updatedList);
    const activatedAccount = updatedList.find((account) => account.isActive);
    
    if (activatedAccount) {
      await applyAccountState(activatedAccount, { syncStorage: true });
    }

    return activatedAccount;
  };

  const removeConnectedAccount = async (accountId, accountType = 'google') => {
    const prevAccounts = connectedAccountsRef.current || [];
    const allowMultipleAccounts = hasFeature(FEATURES.MULTIPLE_CLOUD_ACCOUNTS, currentUserPlan);
    let removedAccount = null;

    const filteredAccounts = prevAccounts.filter((account) => {
      if (account.id === accountId && account.accountType === accountType) {
        removedAccount = account;
        return false;
      }
      return true;
    });

    let nextActiveAccount = null;
    let updatedList = filteredAccounts;

    if (filteredAccounts.length > 0) {
      const existingActive = filteredAccounts.find((account) => account.isActive);
      if (existingActive) {
        nextActiveAccount = existingActive;
      } else if (allowMultipleAccounts) {
        updatedList = filteredAccounts.map((account, index) => {
          const isActive = index === 0;
          if (isActive) {
            nextActiveAccount = { ...account, isActive: true };
            return nextActiveAccount;
          }
          return { ...account, isActive: false };
        });
      } else {
        nextActiveAccount = { ...filteredAccounts[0], isActive: true };
        updatedList = [nextActiveAccount];
      }
    }

    await setConnectedAccountsState(updatedList);
    if (removedAccount) {
      console.log(
        '[ADMIN] Removing connected account:',
        JSON.stringify({
          email: removedAccount.email,
          id: removedAccount.id,
          name: removedAccount.name,
          photo: removedAccount.photo,
        })
      );
    }
    console.log(
      '[ADMIN] Connected accounts after removal:',
      JSON.stringify(
        updatedList.map(({ id, email, name, photo, isActive }) => ({
          id,
          email,
          name,
          photo,
          isActive,
        }))
      )
    );

    if (nextActiveAccount) {
      await applyAccountState(nextActiveAccount, { syncStorage: true });
    } else {
      await applyAccountState(null, { syncStorage: true });
    }

    return { removedAccount, activeAccount: nextActiveAccount };
  };

  const clearAllConnectedAccounts = async () => {
    await setConnectedAccountsState([]);
    await applyAccountState(null, { syncStorage: true });
  };

  // Load saved admin data on mount
  useEffect(() => {
    loadAdminData();
  }, []);

  /**
   * Load saved admin data from storage
   */
  const loadAdminData = async () => {
    try {
      setIsLoading(true);

      let storedAccounts = [];
      try {
        const accountsRaw = await AsyncStorage.getItem(STORAGE_KEYS.CONNECTED_ACCOUNTS);
        storedAccounts = accountsRaw ? JSON.parse(accountsRaw) || [] : [];
      } catch (error) {
        console.warn('[ADMIN] Failed to parse stored connected accounts:', error?.message || error);
      }

      if (storedAccounts.length > 0) {
        // Deduplicate accounts: remove duplicates based on id + accountType
        // Also ensure all accounts have accountType set (default to 'google' for old accounts)
        const seen = new Map();
        const deduplicatedAccounts = [];
        
        for (const account of storedAccounts) {
          const accountType = account.accountType || 'google';
          const key = `${account.id}_${accountType}`;
          
          if (!seen.has(key)) {
            seen.set(key, true);
            deduplicatedAccounts.push({
              ...account,
              accountType: accountType, // Ensure accountType is set
            });
          } else {
            // If duplicate found, keep the one with isActive=true or the most recent
            const existingIndex = deduplicatedAccounts.findIndex(
              (acc) => acc.id === account.id && (acc.accountType || 'google') === accountType
            );
            if (existingIndex >= 0) {
              const existing = deduplicatedAccounts[existingIndex];
              // Keep the active one, or the one with later lastConnectedAt
              if (account.isActive || (!existing.isActive && (account.lastConnectedAt || 0) > (existing.lastConnectedAt || 0))) {
                deduplicatedAccounts[existingIndex] = {
                  ...account,
                  accountType: accountType,
                };
              }
            }
          }
        }
        
        storedAccounts = deduplicatedAccounts;
        
        let activeAccount = storedAccounts.find((account) => account.isActive);
        if (!activeAccount) {
          activeAccount = { ...storedAccounts[0], isActive: true };
          storedAccounts = storedAccounts.map((account, index) => ({
            ...account,
            isActive: index === 0,
          }));
          await persistConnectedAccounts(storedAccounts);
        }

        await setConnectedAccountsState(storedAccounts, { persist: false });
        await applyAccountState(activeAccount, { syncStorage: true });
        return;
      }

      const storedUser = await googleAuthService.getStoredUserInfo();
      const storedMode = await AsyncStorage.getItem(STORAGE_KEYS.ADMIN_USER_MODE);
      const storedProxySessionId = await AsyncStorage.getItem(STORAGE_KEYS.PROXY_SESSION_ID);

      let storedTeamInfo = null;
      let folderValue = null;
      let inviteTokensValue = [];
      let planLimitValue = 5;
      let teamNameValue = '';

      if (storedProxySessionId) {
        setProxySessionId(storedProxySessionId);
      }

      if (storedUser) {
        setUserInfo(storedUser);
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
      }

      setUserMode(storedMode);

      if (storedMode === 'admin' && storedUser) {
        const [
          storedFolderId,
          storedTokens,
          storedPlanLimit,
          storedTeamName,
        ] = await AsyncStorage.multiGet([
          STORAGE_KEYS.ADMIN_FOLDER_ID,
          STORAGE_KEYS.ADMIN_INVITE_TOKENS,
          STORAGE_KEYS.ADMIN_PLAN_LIMIT,
          STORAGE_KEYS.TEAM_NAME,
        ]);

        folderValue = storedFolderId[1] || null;
        inviteTokensValue = storedTokens[1] ? JSON.parse(storedTokens[1]) : [];
        planLimitValue = storedPlanLimit[1] ? parseInt(storedPlanLimit[1], 10) : 5;
        teamNameValue = storedTeamName[1] || '';

        setFolderId(folderValue);
        setInviteTokens(inviteTokensValue);
        setPlanLimit(planLimitValue);
        setTeamName(teamNameValue);
      } else if (storedMode === 'team_member') {
        const storedTeamInfoRaw = await AsyncStorage.getItem(STORAGE_KEYS.TEAM_MEMBER_INFO);
        if (storedTeamInfoRaw) {
          try {
            storedTeamInfo = JSON.parse(storedTeamInfoRaw);
            setTeamInfo(storedTeamInfo);
          } catch (error) {
            console.warn('[ADMIN] Failed to parse stored team info:', error?.message || error);
          }
        }
      }

      if (storedUser) {
        const migratedAccount = {
          id: storedUser.id,
          email: storedUser.email,
          name: storedUser.name || storedUser.givenName || '',
          photo: storedUser.photo || null,
          userInfo: storedUser,
          isActive: true,
          lastConnectedAt: Date.now(),
          folderId: folderValue,
          inviteTokens: inviteTokensValue,
          planLimit: planLimitValue,
          proxySessionId: storedProxySessionId || null,
          teamName: teamNameValue,
          userMode: storedMode || 'admin',
          teamInfo: storedTeamInfo,
        };

        await setConnectedAccountsState([migratedAccount]);
      }
    } catch (error) {
      console.error('Failed to load admin data:', error);
      setIsAuthenticated(false);
      setUserInfo(null);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Sign in for admin (team) use
   */
  const adminSignIn = async () => {
    try {
      console.log("Admin sign-in process started...");
      const result = await googleAuthService.signInAsAdmin();
      console.log("Received response from Google Sign-In service:", JSON.stringify(result, null, 2));

      if (result && result.error) {
        console.log('Sign-in failed with error:', result.error);
        return { success: false, error: result.error };
      }

      if (result && result.userInfo) {
        console.log("Sign-in successful, user info found.");
        setIsAuthenticated(true);
        setUserInfo(result.userInfo);
        setUserMode('admin');
        await upsertConnectedAccount(result.userInfo, { userMode: 'admin' });
        return { success: true };
      }

      throw new Error("Invalid or unexpected response from googleAuthService");
    } catch (error) {
      console.log("Unexpected error in admin sign-in flow:", error.message);
      setIsAuthenticated(false);
      return { success: false, error: error.message };
    }
  };

  /**
   * Sign in for individual use
   */
  const individualSignIn = async () => {
    try {
      console.log("Individual sign-in process started...");
      const result = await googleAuthService.signInAsIndividual();
      console.log("Received response from Google Sign-In service:", JSON.stringify(result, null, 2));

      if (result && result.error) {
        console.log('Sign-in failed with error:', result.error);
        return { success: false, error: result.error };
      }

      if (result && result.userInfo) {
        console.log("Sign-in successful, user info found.");
        setIsAuthenticated(true);
        setUserInfo(result.userInfo);
        setUserMode('individual');
        await upsertConnectedAccount(result.userInfo, { userMode: 'individual' });
        return { success: true };
      }

      throw new Error("Invalid or unexpected response from googleAuthService");
    } catch (error) {
      console.log("Unexpected error in individual sign-in flow:", error.message);
      setIsAuthenticated(false);
      return { success: false, error: error.message };
    }
  };

  /**
   * Join a team as a member (proxy server only)
   */
  const joinTeam = async (token, sessionId) => {
    try {
      if (!token || !sessionId) {
        throw new Error('Missing token or sessionId');
      }

      // Store current individual plan, mode, and name before switching to team mode
      const settingsKey = 'app-settings';
      const storedSettings = await AsyncStorage.getItem(settingsKey);
      const settings = storedSettings ? JSON.parse(storedSettings) : {};
      const currentPlan = settings.userPlan || 'starter';
      const currentMode = userMode || 'individual';
      const currentUserName = settings.userName || '';
      
      // Only store if not already in team mode (to preserve original settings)
      const storedPlan = await AsyncStorage.getItem(STORAGE_KEYS.STORED_INDIVIDUAL_PLAN);
      if (!storedPlan && currentMode !== 'team_member') {
        await AsyncStorage.setItem(STORAGE_KEYS.STORED_INDIVIDUAL_PLAN, currentPlan);
        await AsyncStorage.setItem(STORAGE_KEYS.STORED_INDIVIDUAL_MODE, currentMode);
        // Also store the individual user's name to restore later
        if (currentUserName) {
          await AsyncStorage.setItem('@stored_individual_name', currentUserName);
        }
        console.log('[ADMIN] Stored individual plan, mode, and name:', { plan: currentPlan, mode: currentMode, userName: currentUserName });
      }

      // Get team member's name from settings (this should be the name entered in the test modal or join flow)
      const memberName = settings.userName || 'Team Member';
      
      // Ensure the team member name is set in settings (this is the name used for the team member account)
      // Note: The name should already be set from the test modal, but we ensure it's there

      // Register team member join with proxy server
      try {
        await proxyService.registerTeamMemberJoin(sessionId, token, memberName);
        console.log('[ADMIN] Team member registered with proxy server');
      } catch (registerError) {
        console.warn('[ADMIN] Failed to register team member (non-critical):', registerError.message);
        // Continue anyway - the join can still work
      }

      const newTeamInfo = { token, sessionId, useProxy: true };
      
      await AsyncStorage.setItem(STORAGE_KEYS.TEAM_MEMBER_INFO, JSON.stringify(newTeamInfo));
      await AsyncStorage.setItem(STORAGE_KEYS.ADMIN_USER_MODE, 'team_member');
      setTeamInfo(newTeamInfo);
      setUserMode('team_member');
      await updateUserPlan('Team Member');
      await updateActiveAccount({
        userMode: 'team_member',
        teamInfo: newTeamInfo,
      });
      // No Google Sign-In for team members, so auth status is not changed
      return { success: true };
    } catch (error) {
      console.error("Error joining team:", error);
      return { success: false, error: error.message };
    }
  };

  /**
   * Switch back to individual mode from team mode
   * Restores the stored individual plan, mode, and name
   */
  const switchToIndividualMode = async () => {
    try {
      console.log('[ADMIN] switchToIndividualMode called - starting switch');
      console.log('[ADMIN] Current state:', {
        userMode,
        proxySessionId,
        inviteTokens: inviteTokens?.length || 0,
        folderId
      });

      // Get stored individual plan, mode, and name
      const [storedPlan, storedMode, storedName] = await AsyncStorage.multiGet([
        STORAGE_KEYS.STORED_INDIVIDUAL_PLAN,
        STORAGE_KEYS.STORED_INDIVIDUAL_MODE,
        '@stored_individual_name',
      ]);

      const individualPlan = storedPlan[1] || 'starter';
      const individualMode = storedMode[1] || 'individual';
      const individualName = storedName[1] || '';

      console.log('[ADMIN] Switching back to individual mode:', { plan: individualPlan, mode: individualMode, userName: individualName });
      console.log('[ADMIN] Stored values from AsyncStorage:', { storedPlan: storedPlan[1], storedMode: storedMode[1], storedName: storedName[1] });

      // Clear team member info
      await AsyncStorage.removeItem(STORAGE_KEYS.TEAM_MEMBER_INFO);
      setTeamInfo(null);

      // Restore individual mode and plan
      await AsyncStorage.setItem(STORAGE_KEYS.ADMIN_USER_MODE, individualMode);
      setUserMode(individualMode);
      
      // Restore the individual user's plan
      await updateUserPlan(individualPlan);
      
      // Restore the individual user's name if it was stored
      if (individualName) {
        // Use the SettingsContext method to properly update the name and trigger re-renders
        if (settingsContext && settingsContext.updateUserInfo) {
          await settingsContext.updateUserInfo(individualName);
          console.log('[ADMIN] Restored individual user name via SettingsContext:', individualName);
        } else {
          // Fallback: directly update AsyncStorage if SettingsContext is not available
          const settingsKey = 'app-settings';
          const storedSettings = await AsyncStorage.getItem(settingsKey);
          const settings = storedSettings ? JSON.parse(storedSettings) : {};
          await AsyncStorage.setItem(settingsKey, JSON.stringify({
            ...settings,
            userName: individualName
          }));
          console.log('[ADMIN] Restored individual user name directly:', individualName);
        }
      }

      // If the stored mode was 'admin', we need to restore admin state
      // But we don't restore folderId/proxySessionId as those require re-authentication
      if (individualMode === 'admin') {
        // Keep isAuthenticated and userInfo if they exist
        // User will need to reconnect team if they want team features
      }

      await updateActiveAccount({
        userMode: individualMode,
        teamInfo: null,
      });

      return { success: true, plan: individualPlan, mode: individualMode };
    } catch (error) {
      console.error("Error switching to individual mode:", error);
      return { success: false, error: error.message };
    }
  };

  /**
   * Sign out from team only (keeps Google authentication)
   * For Business/Enterprise users who want to disconnect team but stay signed in to Google
   */
  const signOutFromTeam = async () => {
    try {
      // Clear only team setup data, keep Google authentication
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.ADMIN_FOLDER_ID,
        STORAGE_KEYS.ADMIN_INVITE_TOKENS,
        STORAGE_KEYS.ADMIN_PLAN_LIMIT,
        STORAGE_KEYS.PROXY_SESSION_ID,
        STORAGE_KEYS.TEAM_NAME,
      ]);
      setFolderId(null);
      setInviteTokens([]);
      setProxySessionId(null);
      setPlanLimit(5); // Reset to default
      setTeamName(''); // Clear team name
      // Keep isAuthenticated, userInfo, and userMode='admin'
      await updateActiveAccount({
        folderId: null,
        inviteTokens: [],
        proxySessionId: null,
        planLimit: 5,
        teamName: '',
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  /**
   * Sign out completely (clears Google authentication and all data)
   */
  const signOut = async () => {
    try {
      const activeAccount = getActiveAccount();
      await googleAuthService.signOut();
      await clearAdminData();
      await AsyncStorage.removeItem(STORAGE_KEYS.ADMIN_USER_MODE);
      await AsyncStorage.removeItem(STORAGE_KEYS.TEAM_MEMBER_INFO);
      if (activeAccount) {
        await removeConnectedAccount(activeAccount.id);
      } else {
        await applyAccountState(null, { syncStorage: true });
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  /**
   * Fully disconnect all Google accounts and clear stored admin state.
   * Used when resetting user data to ensure a clean slate.
   */
  const disconnectAllAccounts = async () => {
    try {
      // Attempt to revoke and sign out to ensure all permissions are cleared.
      if (googleAuthService.isAvailable()) {
        try {
          await googleAuthService.signOutAndRevoke();
        } catch (revokeError) {
          console.warn('[ADMIN] Failed to revoke access, falling back to signOut:', revokeError.message);
          try {
            await googleAuthService.signOut();
          } catch (signOutError) {
            console.warn('[ADMIN] Fallback signOut failed:', signOutError.message);
          }
        }
      }

      // Ensure any stored auth artifacts are removed even in Expo Go (where native sign-out isn't available)
      try {
        await googleAuthService.clearUserInfo();
        await googleAuthService.clearServerAuthCode();
      } catch (clearError) {
        console.warn('[ADMIN] Error clearing stored auth info:', clearError.message);
      }
    } catch (authError) {
      console.warn('[ADMIN] Error while disconnecting Google accounts:', authError.message);
    }

    // Remove all admin-related AsyncStorage keys
    try {
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.ADMIN_FOLDER_ID,
        STORAGE_KEYS.ADMIN_INVITE_TOKENS,
        STORAGE_KEYS.ADMIN_PLAN_LIMIT,
        STORAGE_KEYS.ADMIN_USER_MODE,
        STORAGE_KEYS.TEAM_MEMBER_INFO,
        STORAGE_KEYS.PROXY_SESSION_ID,
        STORAGE_KEYS.TEAM_NAME,
        STORAGE_KEYS.STORED_INDIVIDUAL_PLAN,
        STORAGE_KEYS.STORED_INDIVIDUAL_MODE,
      ]);
      await AsyncStorage.removeItem('@stored_individual_name');
    } catch (storageError) {
      console.warn('[ADMIN] Error clearing stored admin data:', storageError.message);
    }

    await clearAllConnectedAccounts();
    setIsInitializingProxy(false);

    // Reset user plan back to starter if available
    try {
      await updateUserPlan('starter');
    } catch (planError) {
      console.warn('[ADMIN] Failed to reset user plan during disconnect:', planError.message);
    }

    return { success: true };
  };

  /**
   * Save folder ID
   */
  const saveFolderId = async (id) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.ADMIN_FOLDER_ID, id);
      setFolderId(id);
      await updateActiveAccount({ folderId: id });
    } catch (error) {
      throw error;
    }
  };


  /**
   * Add a new invite token
   */
  const addInviteToken = async (token) => {
    try {
      const newTokens = [...inviteTokens, token];
      await AsyncStorage.setItem(STORAGE_KEYS.ADMIN_INVITE_TOKENS, JSON.stringify(newTokens));
      setInviteTokens(newTokens);
      await updateActiveAccount({ inviteTokens: newTokens });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  /**
   * Remove an invite token
   */
  const removeInviteToken = async (token) => {
    try {
      const newTokens = inviteTokens.filter(t => t !== token);
      await AsyncStorage.setItem(STORAGE_KEYS.ADMIN_INVITE_TOKENS, JSON.stringify(newTokens));
      setInviteTokens(newTokens);
      await updateActiveAccount({ inviteTokens: newTokens });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  /**
   * Update plan limit
   */
  const updatePlanLimit = async (limit) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.ADMIN_PLAN_LIMIT, limit.toString());
      setPlanLimit(limit);
      await updateActiveAccount({ planLimit: limit });
    } catch (error) {
      throw error;
    }
  };

  /**
   * Clear all admin data
   */
  const clearAdminData = async () => {
    try {
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.ADMIN_FOLDER_ID,
        STORAGE_KEYS.ADMIN_INVITE_TOKENS,
        STORAGE_KEYS.ADMIN_PLAN_LIMIT,
        STORAGE_KEYS.TEAM_MEMBER_INFO,
        STORAGE_KEYS.PROXY_SESSION_ID,
      ]);
      setProxySessionId(null);
      await updateActiveAccount({
        folderId: null,
        inviteTokens: [],
        planLimit: 5,
        proxySessionId: null,
        teamName: '',
        teamInfo: null,
      });
    } catch (error) {
      throw error;
    }
  };

  /**
   * Initialize or retrieve proxy session ID
   * @param {string} folderId - Google Drive folder ID
   * @returns {Promise<string|null>} - Proxy session ID or null if failed
   */
  const initializeProxySession = async (folderId) => {
    // Prevent concurrent initialization calls
      if (isInitializingProxy) {
        console.log('[ADMIN] Proxy session initialization already in progress, waiting...');
        // Wait a bit and check again
        await new Promise(resolve => setTimeout(resolve, 500));
        if (proxySessionId) {
          return { sessionId: proxySessionId, success: true };
        }
        return { success: false, error: 'Initialization in progress' };
      }

    try {
      // If we already have a session ID, return it
      if (proxySessionId) {
        console.log('[ADMIN] Using existing proxy session ID');
        await updateActiveAccount({ proxySessionId });
        return { sessionId: proxySessionId, success: true };
      }

      // Check storage for existing session
      const storedSessionId = await AsyncStorage.getItem(STORAGE_KEYS.PROXY_SESSION_ID);
      if (storedSessionId) {
        console.log('[ADMIN] Found stored proxy session ID');
        setProxySessionId(storedSessionId);
        await updateActiveAccount({ proxySessionId: storedSessionId });
        return { sessionId: storedSessionId, success: true };
      }

      // Set guard to prevent concurrent calls
      setIsInitializingProxy(true);
      
      // Initialize new session via proxy service
      console.log('[ADMIN] Initializing new proxy session');
      const result = await proxyService.initializeAdminSession(folderId);
      
      if (result && result.sessionId) {
        await AsyncStorage.setItem(STORAGE_KEYS.PROXY_SESSION_ID, result.sessionId);
        setProxySessionId(result.sessionId);
        await updateActiveAccount({ proxySessionId: result.sessionId });
        console.log('[ADMIN] Proxy session initialized successfully');
        setIsInitializingProxy(false);
        return { sessionId: result.sessionId, success: true };
      }

      throw new Error('Failed to initialize proxy session - no sessionId returned');
    } catch (error) {
      console.error('[ADMIN] Error initializing proxy session:', error);
      setIsInitializingProxy(false);
      // Return error object instead of null
      return { success: false, error: error.message };
    }
  };

  /**
   * Check if admin setup is complete (proxy server only)
   */
  const isSetupComplete = () => {
    return isAuthenticated && folderId && proxySessionId;
  };

  /**
   * Check if user can add more invites
   */
  const canAddMoreInvites = () => {
    return inviteTokens.length < planLimit;
  };

  /**
   * Get remaining invite slots
   */
  const getRemainingInvites = () => {
    return Math.max(0, planLimit - inviteTokens.length);
  };

  /**
   * Update team name
   */
  const updateTeamName = async (name) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.TEAM_NAME, name);
      setTeamName(name);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  const value = {
    // State
    isAuthenticated,
    userInfo,
    folderId,
    inviteTokens,
    planLimit,
    isLoading,
    userMode,
    teamInfo,
    proxySessionId,
    teamName,
    connectedAccounts,
    isGoogleSignInAvailable: googleAuthService.isAvailable(),

    // Actions
    adminSignIn,
    individualSignIn,
    signOut,
    signOutFromTeam,
    joinTeam,
    switchToIndividualMode,
    saveFolderId,
    addInviteToken,
    removeInviteToken,
    updatePlanLimit,
    clearAdminData,
    initializeProxySession,
    disconnectAllAccounts,
    removeConnectedAccount,
    upsertConnectedAccount,
    activateConnectedAccount,

    // Helpers
    isSetupComplete,
    canAddMoreInvites,
    getRemainingInvites,
    updateTeamName,

    // Direct access to auth service for API calls
    googleAuthService,
  };

  return (
    <AdminContext.Provider value={value}>
      {children}
    </AdminContext.Provider>
  );
}

/**
 * Hook to use admin context
 */
export function useAdmin() {
  const context = useContext(AdminContext);
  if (!context) {
    throw new Error('useAdmin must be used within an AdminProvider');
  }
  return context;
}
