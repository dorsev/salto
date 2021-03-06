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
import { Field, Value } from '@salto-io/adapter-api'
import { GetLookupNameFunc } from '@salto-io/adapter-utils'
import { TASK_TYPE, WORKFLOW_TYPE } from './constants'

type LookupFunc = (val: Value, context?: string) => string

export type ReferenceSerializationStrategy = {
  serialize: GetLookupNameFunc
  lookup: LookupFunc
}

type ReferenceSerializationStrategyName = 'fullValue' | 'id' | 'name'
const ReferenceSerializationStrategyLookup: Record<
  ReferenceSerializationStrategyName, ReferenceSerializationStrategy
> = {
  fullValue: {
    serialize: ({ ref }) => ref.value,
    lookup: val => val,
  },
  id: {
    serialize: ({ ref }) => ref.value.value.id,
    lookup: val => val,
  },
  name: {
    serialize: ({ ref }) => ref.value.value.name,
    lookup: val => val,
  },
}

type ReferenceTargetDefinition = {
  name?: string
  type: string
  parent?: string
}
export type ExtendedReferenceTargetDefinition = ReferenceTargetDefinition & { lookup: LookupFunc }

type SourceDef = {
  field: string | RegExp
  parentTypes: string[]
}

/**
 * A rule defining how to convert values to reference expressions (on fetch),
 * and reference expressions back to values (on deploy).
 */
export type FieldReferenceDefinition = {
  src: SourceDef
  serializationStrategy?: ReferenceSerializationStrategyName
  // If target is missing, the definition is used for resolving
  target?: ReferenceTargetDefinition
}

/**
 * The rules for finding and resolving values into (and back from) reference expressions.
 * Overlaps between rules are allowed, and the first successful conversion wins.
 * Current order (defined by generateReferenceResolverFinder):
 *  1. Exact field names take precedence over regexp
 *  2. Order within each group is currently *not* guaranteed (groupBy is not stable)
 *
 * A value will be converted into a reference expression if:
 * 1. An element matching the rule is found.
 * 2. Resolving the resulting reference expression back returns the original value.
 */
export const fieldNameToTypeMappingDefs: FieldReferenceDefinition[] = [
  {
    src: { field: 'source_workflow_id', parentTypes: ['Linkage'] },
    serializationStrategy: 'id',
    target: { type: WORKFLOW_TYPE },
  },
  {
    src: { field: 'target_task_id', parentTypes: ['Linkage'] },
    serializationStrategy: 'id',
    target: { type: TASK_TYPE },
  },
  {
    src: { field: 'source_task_id', parentTypes: ['Linkage'] },
    serializationStrategy: 'id',
    target: { type: TASK_TYPE },
  },
  {
    src: { field: 'revenueRecognitionRuleName', parentTypes: ['GETProductRatePlanChargeType'] },
    serializationStrategy: 'name',
    target: { type: 'Settings_RevenueRecognitionRule' },
  },
]

export class FieldReferenceResolver {
  src: SourceDef
  serializationStrategy: ReferenceSerializationStrategy
  target?: ExtendedReferenceTargetDefinition

  constructor(def: FieldReferenceDefinition) {
    this.src = def.src
    this.serializationStrategy = ReferenceSerializationStrategyLookup[
      def.serializationStrategy ?? 'fullValue'
    ]
    this.target = def.target
      ? { ...def.target, lookup: this.serializationStrategy.lookup }
      : undefined
  }

  static create(def: FieldReferenceDefinition): FieldReferenceResolver {
    return new FieldReferenceResolver(def)
  }

  match(field: Field): boolean {
    return (
      field.name === this.src.field
      && this.src.parentTypes.includes(field.parent.elemID.name)
    )
  }
}

export type ReferenceResolverFinder = (field: Field) => FieldReferenceResolver[]

/**
 * Generates a function that filters the relevant resolvers for a given field.
 */
export const generateReferenceResolverFinder = (
  defs = fieldNameToTypeMappingDefs,
): ReferenceResolverFinder => {
  const referenceDefinitions = defs.map(
    def => FieldReferenceResolver.create(def)
  )

  const matchersByFieldName = _(referenceDefinitions)
    .filter(def => _.isString(def.src.field))
    .groupBy(def => def.src.field)
    .value()

  return (field => (
    (matchersByFieldName[field.name] ?? []).filter(resolver => resolver.match(field))
  ))
}
