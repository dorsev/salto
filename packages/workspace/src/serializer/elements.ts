/*
*                      Copyright 2021 Salto Labs Ltd.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with
* the License.  You may obtain a copy of the License at
*
*     http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
import _ from 'lodash'
import { types } from '@salto-io/lowerdash'
import {
  PrimitiveType, ElemID, Field, Element, ListType, MapType,
  ObjectType, InstanceElement, isType, isElement, isContainerType,
  ReferenceExpression, TemplateExpression, VariableExpression,
  isReferenceExpression, Variable, StaticFile, isStaticFile,
  BuiltinTypes, TypeElement, isInstanceElement, isPrimitiveType, TypeMap,
} from '@salto-io/adapter-api'

import { InvalidStaticFile } from '../workspace/static_files/common'

// There are two issues with naive json stringification:
//
// 1) The class type information and methods are lost
//
// 2) Pointers are dumped by value, so if multiple object
//    point to the same object (for example, multiple type
//    instances for the same type) then the stringify process
//    will result in multiple copies of that object.
//
// To address this issue the serialization process:
//
// 1. Adds a '_salto_class' field with the class name to the object during the serialization.
// 2. Replaces all of the pointers with "placeholder" objects
//
// The deserialization process recover the information by creating the classes based
// on the _salto_class field, and then replacing the placeholders using the regular merge method.

// Do not use the class's name for serialization since it can change (e.g. by webpack)
/* eslint-disable object-shorthand */
const NameToType = {
  InstanceElement: InstanceElement,
  ObjectType: ObjectType,
  Variable: Variable,
  PrimitiveType: PrimitiveType,
  ListType: ListType,
  MapType: MapType,
  Field: Field,
  TemplateExpression: TemplateExpression,
  ReferenceExpression: ReferenceExpression,
  VariableExpression: VariableExpression,
  StaticFile: StaticFile,
}
const nameToTypeEntries = Object.entries(NameToType)
const possibleTypes = Object.values(NameToType)


type SerializedName = keyof typeof NameToType
type Serializable = InstanceType<types.ValueOf<typeof NameToType>>

export const SALTO_CLASS_FIELD = '_salto_class'
type SerializedClass = {
  [SALTO_CLASS_FIELD]: SerializedName
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

const ctorNameToSerializedName: Record<string, SerializedName> = _(NameToType).entries()
  .map(([name, type]) => [type.name, name]).fromPairs()
  .value()

type ReviverMap = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in SerializedName]: (v: any) => InstanceType<(typeof NameToType)[K]>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isSaltoSerializable(value: any): value is Serializable {
  return _.some(possibleTypes, t => value instanceof t)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isSerializedClass(value: any): value is SerializedClass {
  return _.isPlainObject(value) && SALTO_CLASS_FIELD in value
    && value[SALTO_CLASS_FIELD] in NameToType
}

export const serialize = (elements: Element[],
  referenceSerializerMode: 'replaceRefWithValue' | 'keepRef' = 'replaceRefWithValue'): string => {
  const saltoClassReplacer = <T extends Serializable>(e: T): T & SerializedClass => {
    // Add property SALTO_CLASS_FIELD
    const o = _.clone(e as T & SerializedClass)
    o[SALTO_CLASS_FIELD] = ctorNameToSerializedName[e.constructor.name]
      || nameToTypeEntries.find(([_name, type]) => e instanceof type)?.[0]
    return o
  }
  const staticFileReplacer = (e: StaticFile): Omit<Omit<StaticFile & SerializedClass, 'internalContent'>, 'content'> => (
    _.omit(saltoClassReplacer(e), 'content', 'internalContent')
  )
  const referenceExpressionReplacer = (e: ReferenceExpression):
    ReferenceExpression & SerializedClass => {
    if (e.value === undefined || referenceSerializerMode === 'keepRef') {
      return saltoClassReplacer(e.createWithValue(undefined))
    }
    // Replace ref with value in order to keep the result from changing between
    // a fetch and a deploy.
    if (isElement(e.value)) {
      return saltoClassReplacer(new ReferenceExpression(e.value.elemID))
    }
    return e.value
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resolveCircles = (v: any): any => (
    isPrimitiveType(v)
      ? new PrimitiveType({ elemID: v.elemID, primitive: v.primitive })
      : new ObjectType({ elemID: v.elemID })
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const replacer = (v: any, k: any): any => {
    if (k !== undefined) {
      if (isType(v) && !isContainerType(v)) {
        return saltoClassReplacer(resolveCircles(v))
      }
      if (isReferenceExpression(v)) {
        return referenceExpressionReplacer(v)
      }
      if (isStaticFile(v)) {
        return staticFileReplacer(v)
      }
      if (isSaltoSerializable(v)) {
        return saltoClassReplacer(_.cloneDeepWith(v, replacer))
      }
    }
    return undefined
  }
  const cloneElements = elements.map(element => {
    const clone = _.cloneDeepWith(element, replacer)
    return isSaltoSerializable(element) ? saltoClassReplacer(clone) : clone
  })
  const sortedElements = _.sortBy(cloneElements, e => e.elemID.getFullName())
  // We don't use safeJsonStringify to save some time, because we know  we made sure there aren't
  // circles
  // eslint-disable-next-line no-restricted-syntax
  return JSON.stringify(sortedElements)
}

export type StaticFileReviver =
  (staticFile: StaticFile) => Promise<StaticFile | InvalidStaticFile>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reviveElemID = (v: {[key: string]: any}): ElemID => (
  new ElemID(v.adapter, v.typeName, v.idType, ...v.nameParts)
)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reviveType = (v: {[key: string]: any}): ObjectType => (
  v.type ?? new ObjectType({
    elemID: v.refType.elemId,
  })
)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reviveInnerType = (v: {[key: string]: any}): ObjectType => (
  v.innerType ?? new ObjectType({
    elemID: v.innerRefType.elemId,
  })
)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reviveAnnotationTypes = (v: {[key: string]: any}): TypeMap => (
  v.annotationTypes ?? _.mapValues(
    v.annotationRefTypes,
    anno => new ObjectType({
      elemID: anno.elemId,
    })
  )
)

export const deserialize = async (
  data: string,
  staticFileReviver?: StaticFileReviver,
): Promise<Element[]> => {
  let staticFiles: Record<string, StaticFile> = {}

  const revivers: ReviverMap = {
    InstanceElement: v => new InstanceElement(
      reviveElemID(v.elemID).name,
      reviveType(v),
      v.value,
      undefined,
      v.annotations,
    ),
    ObjectType: v => new ObjectType({
      elemID: reviveElemID(v.elemID),
      fields: v.fields,
      annotationTypes: reviveAnnotationTypes(v),
      annotations: v.annotations,
      isSettings: v.isSettings,
    }),
    Variable: v => (
      new Variable(reviveElemID(v.elemID), v.value)
    ),
    PrimitiveType: v => new PrimitiveType({
      elemID: reviveElemID(v.elemID),
      primitive: v.primitive,
      annotationTypes: reviveAnnotationTypes(v),
      annotations: v.annotations,
    }),
    ListType: v => new ListType(
      reviveInnerType(v)
    ),
    MapType: v => new MapType(
      reviveInnerType(v)
    ),
    Field: v => new Field(
      new ObjectType({ elemID: reviveElemID(v.elemID).createParentID() }),
      v.name,
      reviveType(v),
      v.annotations,
    ),
    TemplateExpression: v => (
      new TemplateExpression({ parts: v.parts })
    ),
    ReferenceExpression: v => (
      new ReferenceExpression(reviveElemID(v.elemId ?? v.elemID))
    ),
    VariableExpression: v => (
      new VariableExpression(reviveElemID(v.elemId ?? v.elemID))
    ),
    StaticFile: v => {
      const staticFile = new StaticFile(
        { filepath: v.filepath, hash: v.hash, encoding: v.encoding }
      )
      staticFiles[staticFile.filepath] = staticFile
      return staticFile
    },
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const elementReviver = (_k: string, v: any): any => {
    if (isSerializedClass(v)) {
      const reviver = revivers[v[SALTO_CLASS_FIELD]]
      const e = reviver(v)
      if (isType(e) || isInstanceElement(e)) {
        e.path = v.path
      }
      return e
    }
    return v
  }

  const elements = JSON.parse(data, elementReviver) as Element[]

  if (staticFileReviver) {
    staticFiles = _.fromPairs(
      (await Promise.all(
        _.entries(staticFiles).map(async ([key, val]) => ([key, await staticFileReviver(val)]))
      ))
    )
  }
  const elementsMap = _.keyBy(elements.filter(isType), e => e.elemID.getFullName())
  const builtinMap = _(BuiltinTypes).values().keyBy(b => b.elemID.getFullName()).value()
  const typeMap = _.merge({}, elementsMap, builtinMap)
  const resolveType = (type: TypeElement): TypeElement | undefined => {
    if (isContainerType(type)) {
      const innerType = resolveType(type.innerType) ?? type.innerType
      type.setInnerType(innerType)
      return type
    }
    return typeMap[type.elemID.getFullName()]
  }

  elements.forEach(element => {
    // We use cloneDeep for the iteration but we change the objects in-place in order to preserve
    // references between objects
    _.cloneDeepWith(element, (value, key, object) => {
      if (object === undefined || key === undefined) {
        // We don't get object/key if and only if this is called on the top level element
        if (isContainerType(value)) {
          resolveType(value)
          return 'stop recursion'
        }
        return undefined
      }
      if (isType(value)) {
        const resolvedType = resolveType(value)
        if (resolvedType !== undefined) {
          _.set(object, key, resolvedType)
          return 'stop recursion'
        }
        return undefined
      }
      if (isStaticFile(value)) {
        _.set(object, key, staticFiles[value.filepath])
        return 'stop recursion'
      }
      return undefined
    })
  })

  return Promise.resolve(elements)
}
