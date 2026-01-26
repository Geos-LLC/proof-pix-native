import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { usePhotos } from '../context/PhotoContext';
import { useSettings } from '../context/SettingsContext';
import { useAdmin } from '../context/AdminContext';
import { COLORS } from '../constants/rooms';
import { useFeaturePermissions } from '../hooks/useFeaturePermissions';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';

export default function ProjectsScreen({ navigation }) {
  const { t } = useTranslation();
  const {
    projects,
    getPhotosByProject,
    deleteProject,
    setActiveProject,
    activeProjectId,
    createProject,
    photos,
  } = usePhotos();
  
  const { userName, userPlan, updateUserPlan } = useSettings();
  const { userMode } = useAdmin();
  const { exceedsLimit } = useFeaturePermissions();
  const isTeamMember = userMode === 'team_member' || userPlan === 'team' || userPlan === 'Team Member';
  
  const [newProjectVisible, setNewProjectVisible] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creating, setCreating] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [showPlanModal, setShowPlanModal] = useState(false);

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      Alert.alert(t('common.error'), t('projects.enterProjectName'));
      return;
    }

    if (!userName) {
      Alert.alert(
        t('projects.userNameRequiredTitle'),
        t('projects.userNameRequiredMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('projects.goToSettings'), onPress: () => navigation.navigate('Settings') }
        ]
      );
      return;
    }

    if (!isTeamMember && exceedsLimit('maxProjects', projects.length)) {
      setShowPlanModal(true);
      return;
    }

    const existing = projects.map(p => p.name);
    if (existing.includes(newProjectName.trim())) {
      Alert.alert(t('common.error'), 'A project with this name already exists.');
      return;
    }

    try {
      setCreating(true);
      const project = await createProject(newProjectName.trim());
      setNewProjectName('');
      setNewProjectVisible(false);
      setActiveProject(project.id);
      navigation.navigate('Gallery');
    } catch (e) {
      Alert.alert(t('common.error'), e?.message || t('projects.createError'));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteProject = (project) => {
    setProjectToDelete(project);
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirmed = async (deleteFromStorage) => {
    if (!projectToDelete) return;
    
    try {
      await deleteProject(projectToDelete.id, { deleteFromStorage });
      if (activeProjectId === projectToDelete.id) {
        if (projects.length > 1) {
          const remainingProjects = projects.filter(p => p.id !== projectToDelete.id);
          if (remainingProjects.length > 0) {
            setActiveProject(remainingProjects[0].id);
          } else {
            setActiveProject(null);
          }
        } else {
          setActiveProject(null);
        }
      }
    } catch (error) {
      Alert.alert(t('common.error'), 'Failed to delete project.');
    } finally {
      setShowDeleteConfirm(false);
      setProjectToDelete(null);
    }
  };

  const handleShareProject = async (project) => {
    const projectPhotos = getPhotosByProject(project.id);
    if (projectPhotos.length === 0) {
      Alert.alert(t('gallery.noPhotosTitle'), t('gallery.noPhotosInProject'));
      return;
    }
    
    setActiveProject(project.id);
    navigation.navigate('Gallery', { shareOnOpen: true });
  };

  const handleUploadProject = async (project) => {
    const projectPhotos = getPhotosByProject(project.id);
    if (projectPhotos.length === 0) {
      Alert.alert(t('gallery.noPhotosTitle'), 'No photos to upload in this project.');
      return;
    }
    
    setActiveProject(project.id);
    navigation.navigate('Gallery', { uploadOnOpen: true });
  };

  const handleSelectProject = (project) => {
    setActiveProject(project.id);
    navigation.navigate('Gallery');
  };

  const getProjectPhotoCount = (projectId) => {
    return getPhotosByProject(projectId).length;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>
          {t('projects.title')} ({projects.length})
        </Text>
      </View>

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.content}
      >
        {projects.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>{t('projects.noProjects')}</Text>
            <Text style={styles.emptyStateSubtext}>
              Create your first project to get started
            </Text>
          </View>
        ) : (
          projects.map((project) => {
            const photoCount = getProjectPhotoCount(project.id);
            const isActive = activeProjectId === project.id;
            
            return (
              <TouchableOpacity
                key={project.id}
                style={[
                  styles.projectCard,
                  isActive && styles.projectCardActive
                ]}
                onPress={() => handleSelectProject(project)}
                activeOpacity={0.7}
              >
                <View style={styles.projectCardContent}>
                  <View style={styles.projectInfo}>
                    <Text style={styles.projectName}>{project.name}</Text>
                    <Text style={styles.projectSubtitle}>
                      {photoCount} {photoCount === 1 ? 'Photo' : 'Photos'}
                    </Text>
                  </View>
                  
                  <View style={styles.projectActions}>
                    <TouchableOpacity
                      style={styles.actionIcon}
                      onPress={(e) => {
                        e.stopPropagation();
                        handleDeleteProject(project);
                      }}
                    >
                      <Ionicons name="trash-outline" size={22} color="#FF4444" />
                    </TouchableOpacity>
                    
                    <TouchableOpacity
                      style={styles.actionIcon}
                      onPress={(e) => {
                        e.stopPropagation();
                        handleShareProject(project);
                      }}
                    >
                      <Ionicons name="paper-plane-outline" size={22} color="#000000" />
                    </TouchableOpacity>
                    
                    <TouchableOpacity
                      style={styles.actionIcon}
                      onPress={(e) => {
                        e.stopPropagation();
                        handleUploadProject(project);
                      }}
                    >
                      <Ionicons name="cloud-upload-outline" size={22} color="#000000" />
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <View style={styles.bottomNavPill}>
        <TouchableOpacity 
          style={styles.navItem}
          onPress={() => navigation.navigate('Home')}
        >
          <Ionicons name="home-outline" size={24} color="#666666" />
          <Text style={styles.navItemText}>Home</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.navItem, styles.navItemActive]}
        >
          <Ionicons name="folder-outline" size={24} color="#000000" />
          <Text style={[styles.navItemText, styles.navItemTextActive]}>Projects</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.navItem}
          onPress={() => navigation.navigate('Gallery')}
        >
          <Ionicons name="images" size={24} color="#666666" />
          <Text style={styles.navItemText}>Gallery</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.navItem}
          onPress={() => navigation.navigate('Settings')}
        >
          <Ionicons name="settings-outline" size={24} color="#666666" />
          <Text style={styles.navItemText}>Settings</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.floatingAddButton}
        onPress={() => {
          if (!isTeamMember && exceedsLimit('maxProjects', projects.length)) {
            setShowPlanModal(true);
            return;
          }
          setNewProjectVisible(true);
        }}
      >
        <Ionicons name="add" size={36} color="#000000" />
      </TouchableOpacity>

      {/* New Project Modal */}
      <Modal
        visible={newProjectVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setNewProjectVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('projects.newProjectTitle')}</Text>
            
            <TextInput
              style={styles.input}
              placeholder={t('projects.enterProjectName')}
              value={newProjectName}
              onChangeText={setNewProjectName}
              autoFocus={true}
              onSubmitEditing={handleCreateProject}
            />
            
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => {
                  setNewProjectVisible(false);
                  setNewProjectName('');
                }}
              >
                <Text style={styles.modalButtonTextCancel}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCreate]}
                onPress={handleCreateProject}
                disabled={creating}
              >
                {creating ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={styles.modalButtonTextCreate}>{t('projects.create')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && projectToDelete && (
        <DeleteConfirmationModal
          visible={showDeleteConfirm}
          onClose={() => {
            setShowDeleteConfirm(false);
            setProjectToDelete(null);
          }}
          onConfirm={handleDeleteConfirmed}
          photoCount={getProjectPhotoCount(projectToDelete.id)}
          deleteFromStorage={true}
          setDeleteFromStorage={() => {}}
          userPlan={userPlan}
          onShowPlanModal={() => setShowPlanModal(true)}
          planModalVisible={showPlanModal}
          onPlanModalClose={() => setShowPlanModal(false)}
          updateUserPlan={updateUserPlan}
          t={t}
        />
      )}

      {(sharing || uploading) && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.PRIMARY} />
            <Text style={styles.loadingText}>
              {sharing ? 'Preparing to share...' : 'Uploading...'}
            </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F8F8',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: 'white',
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    color: COLORS.TEXT,
    letterSpacing: -0.5,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 120,
  },
  projectCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  projectCardActive: {
    borderColor: COLORS.PRIMARY,
  },
  projectCardContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  projectInfo: {
    flex: 1,
  },
  projectName: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT,
    marginBottom: 4,
  },
  projectSubtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666666',
  },
  projectActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  actionIcon: {
    padding: 8,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.TEXT,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#666666',
    textAlign: 'center',
  },
  bottomNavPill: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: 'white',
    borderRadius: 32,
    paddingVertical: 10,
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 90,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 20,
  },
  navItemActive: {
    backgroundColor: '#F0F0F0',
  },
  navItemText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#666666',
    marginTop: 4,
  },
  navItemTextActive: {
    color: '#000000',
    fontWeight: '600',
  },
  floatingAddButton: {
    position: 'absolute',
    bottom: 100,
    right: 20,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.PRIMARY,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 10,
    zIndex: 95,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 24,
    padding: 24,
    width: '85%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.TEXT,
    marginBottom: 20,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    marginBottom: 20,
    backgroundColor: '#F8F8F8',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalButtonCancel: {
    backgroundColor: '#F0F0F0',
  },
  modalButtonCreate: {
    backgroundColor: COLORS.PRIMARY,
  },
  modalButtonTextCancel: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT,
  },
  modalButtonTextCreate: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  loadingContainer: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    minWidth: 200,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT,
  },
});

