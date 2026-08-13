import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Trash2, Plus } from "lucide-react"
import { ProcessedPerson, FamilyGroup } from '../utils/familyDataProcessor'

interface RelationshipEditDialogProps {
  person: ProcessedPerson | null
  isOpen: boolean
  onClose: () => void
  availablePersons: ProcessedPerson[]
  families: FamilyGroup[]
  onAddFamily: (familyData: {
    parentIds: string[]
    childrenIds?: string[]
    marriageDate?: string
    divorceDate?: string
    relationType: 'blood' | 'adoption'
  }) => void
  onUpdateFamily: (id: string, updates: Partial<FamilyGroup>) => void
  onDeleteFamily: (id: string) => void
}

export function RelationshipEditDialog({
  person,
  isOpen,
  onClose,
  availablePersons,
  families,
  onAddFamily,
  onUpdateFamily,
  onDeleteFamily
}: RelationshipEditDialogProps) {
  const [newSpouse, setNewSpouse] = useState('')
  const [marriageDate, setMarriageDate] = useState('')
  const [newChild, setNewChild] = useState('')
  const [newParent, setNewParent] = useState('')
  const [parentType, setParentType] = useState<'blood' | 'adoption'>('blood')

  // 現在の人物に関連する家族関係を取得
  const personFamilies = families.filter(family => 
    family.parents.some(p => p.id === person?.id) || 
    family.children.some(c => c.id === person?.id)
  )

  // 配偶者として追加可能な人物を取得（同世代で既に配偶者でない人）
  const availableSpouses = availablePersons.filter(p => 
    p.id !== person?.id && 
    p.generation === person?.generation &&
    !personFamilies.some(family => 
      family.parents.length === 2 && 
      family.parents.some(parent => parent.id === p.id)
    )
  )

  // 子供として追加可能な人物を取得（次世代で既に子供でない人）
  const availableChildren = availablePersons.filter(p => 
    p.id !== person?.id && 
    p.generation === (person?.generation || 1) + 1 &&
    !personFamilies.some(family => family.children.some(child => child.id === p.id))
  )

  // 親として追加可能な人物を取得（前世代の人）
  const availableParents = availablePersons.filter(p => 
    p.id !== person?.id && 
    p.generation === (person?.generation || 1) - 1
  )

  const handleAddSpouse = () => {
    if (!person || !newSpouse) return

    onAddFamily({
      parentIds: [person.id, newSpouse],
      childrenIds: [],
      marriageDate,
      relationType: 'blood'
    })

    setNewSpouse('')
    setMarriageDate('')
  }

  const handleAddChild = () => {
    if (!person || !newChild) return

    // 既存の配偶者関係があるかチェック
    const existingMarriage = personFamilies.find(family => 
      family.parents.length === 2 && family.parents.some(p => p.id === person.id)
    )

    if (existingMarriage) {
      // 既存の結婚関係に子供を追加
      const currentChildren = existingMarriage.children.map(c => c.id)
      onUpdateFamily(existingMarriage.id, {
        children: [...existingMarriage.children, availableChildren.find(c => c.id === newChild)!]
      })
    } else {
      // 新しい家族関係を作成（単親）
      onAddFamily({
        parentIds: [person.id],
        childrenIds: [newChild],
        relationType: parentType
      })
    }

    setNewChild('')
  }

  const handleAddParent = () => {
    if (!person || !newParent) return

    // 子供として現在の人物を持つ家族関係を作成
    onAddFamily({
      parentIds: [newParent],
      childrenIds: [person.id],
      relationType: parentType
    })

    setNewParent('')
  }

  const handleRemoveFamily = (familyId: string) => {
    if (confirm('この家族関係を削除してもよろしいですか？')) {
      onDeleteFamily(familyId)
    }
  }

  if (!person) return null

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>家族関係の編集 - {person.displayName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* 現在の家族関係 */}
          <div className="space-y-4">
            <h4 className="text-lg font-semibold">現在の家族関係</h4>
            
            {personFamilies.length === 0 ? (
              <p className="text-gray-500">家族関係がありません</p>
            ) : (
              <div className="space-y-3">
                {personFamilies.map((family) => (
                  <div key={family.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex gap-2">
                        <Badge variant={family.relationType === 'blood' ? 'default' : 'secondary'}>
                          {family.relationType === 'blood' ? '血縁' : '養子縁組'}
                        </Badge>
                        {family.marriageDate && (
                          <Badge variant="outline">結婚: {family.marriageDate}</Badge>
                        )}
                      </div>
                      <Button
                        variant="destructive" 
                        size="sm"
                        onClick={() => handleRemoveFamily(family.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <h5 className="font-medium mb-2">親</h5>
                        <div className="space-y-1">
                          {family.parents.map(parent => (
                            <div key={parent.id} className="text-sm">
                              {parent.displayName}
                              {parent.id === person.id && <span className="text-blue-600"> (本人)</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <h5 className="font-medium mb-2">子供</h5>
                        <div className="space-y-1">
                          {family.children.length === 0 ? (
                            <span className="text-gray-500 text-sm">なし</span>
                          ) : (
                            family.children.map(child => (
                              <div key={child.id} className="text-sm">
                                {child.displayName}
                                {child.id === person.id && <span className="text-blue-600"> (本人)</span>}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 配偶者を追加 */}
          <div className="space-y-4">
            <h4 className="text-lg font-semibold">配偶者を追加</h4>
            
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>配偶者</Label>
                <Select value={newSpouse} onValueChange={setNewSpouse}>
                  <SelectTrigger>
                    <SelectValue placeholder="配偶者を選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSpouses.map(person => (
                      <SelectItem key={person.id} value={person.id}>
                        {person.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>結婚日（任意）</Label>
                <Input
                  value={marriageDate}
                  onChange={(e) => setMarriageDate(e.target.value)}
                  placeholder="1984-01-22"
                />
              </div>
              <div className="flex items-end">
                <Button onClick={handleAddSpouse} disabled={!newSpouse}>
                  <Plus className="w-4 h-4 mr-2" />
                  追加
                </Button>
              </div>
            </div>
          </div>

          {/* 子供を追加 */}
          <div className="space-y-4">
            <h4 className="text-lg font-semibold">子供を追加</h4>
            
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>子供</Label>
                <Select value={newChild} onValueChange={setNewChild}>
                  <SelectTrigger>
                    <SelectValue placeholder="子供を選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableChildren.map(person => (
                      <SelectItem key={person.id} value={person.id}>
                        {person.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>関係の種類</Label>
                <Select value={parentType} onValueChange={(value: 'blood' | 'adoption') => setParentType(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blood">血縁</SelectItem>
                    <SelectItem value="adoption">養子縁組</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button onClick={handleAddChild} disabled={!newChild}>
                  <Plus className="w-4 h-4 mr-2" />
                  追加
                </Button>
              </div>
            </div>
          </div>

          {/* 親を追加 */}
          <div className="space-y-4">
            <h4 className="text-lg font-semibold">親を追加</h4>
            
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>親</Label>
                <Select value={newParent} onValueChange={setNewParent}>
                  <SelectTrigger>
                    <SelectValue placeholder="親を選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableParents.map(person => (
                      <SelectItem key={person.id} value={person.id}>
                        {person.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>関係の種類</Label>
                <Select value={parentType} onValueChange={(value: 'blood' | 'adoption') => setParentType(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blood">血縁</SelectItem>
                    <SelectItem value="adoption">養子縁組</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button onClick={handleAddParent} disabled={!newParent}>
                  <Plus className="w-4 h-4 mr-2" />
                  追加
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
} 