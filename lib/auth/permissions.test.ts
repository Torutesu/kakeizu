import { describe, it, expect } from 'vitest'
import {
  canManageMembers,
  canManageOrgSettings,
  canCreateProject,
  canDeleteProject,
  canAssignProjectMembers,
  canViewProject,
  canEditProject,
} from './permissions'

describe('permissions', () => {
  it('メンバー・組織設定・削除・アサインの管理はadminのみ', () => {
    expect(canManageMembers('admin')).toBe(true)
    expect(canManageMembers('worker')).toBe(false)
    expect(canManageMembers('viewer')).toBe(false)

    expect(canManageOrgSettings('admin')).toBe(true)
    expect(canManageOrgSettings('worker')).toBe(false)

    expect(canDeleteProject('admin')).toBe(true)
    expect(canDeleteProject('worker')).toBe(false)

    expect(canAssignProjectMembers('admin')).toBe(true)
    expect(canAssignProjectMembers('worker')).toBe(false)
  })

  it('案件の作成はadminとworkerのみ', () => {
    expect(canCreateProject('admin')).toBe(true)
    expect(canCreateProject('worker')).toBe(true)
    expect(canCreateProject('viewer')).toBe(false)
  })

  describe('canViewProject', () => {
    it('adminはモード・アサインに関わらず常に閲覧可能', () => {
      expect(canViewProject('admin', 'assigned_only', false)).toBe(true)
      expect(canViewProject('admin', 'all_projects', false)).toBe(true)
    })

    it('all_projectsモードでは全員が閲覧可能', () => {
      expect(canViewProject('worker', 'all_projects', false)).toBe(true)
      expect(canViewProject('viewer', 'all_projects', false)).toBe(true)
    })

    it('assigned_onlyモードではアサインされた場合のみ閲覧可能', () => {
      expect(canViewProject('worker', 'assigned_only', true)).toBe(true)
      expect(canViewProject('worker', 'assigned_only', false)).toBe(false)
      expect(canViewProject('viewer', 'assigned_only', true)).toBe(true)
      expect(canViewProject('viewer', 'assigned_only', false)).toBe(false)
    })
  })

  describe('canEditProject', () => {
    it('viewerはアクセスできる案件でも編集不可', () => {
      expect(canEditProject('viewer', 'all_projects', true)).toBe(false)
      expect(canEditProject('viewer', 'assigned_only', true)).toBe(false)
    })

    it('workerはアクセスできる案件のみ編集可能', () => {
      expect(canEditProject('worker', 'all_projects', false)).toBe(true)
      expect(canEditProject('worker', 'assigned_only', true)).toBe(true)
      expect(canEditProject('worker', 'assigned_only', false)).toBe(false)
    })

    it('adminは常に編集可能', () => {
      expect(canEditProject('admin', 'assigned_only', false)).toBe(true)
    })
  })
})
