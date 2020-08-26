/*
*                      Copyright 2020 Salto Labs Ltd.
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
import { Element, ElemID } from '@salto-io/adapter-api'
import { findObjectType } from '@salto-io/adapter-utils'
import { FilterCreator } from '../filter'
import { ConfigChangeSuggestion } from '../types'
import { fetchMetadataInstances, listMetadataObjects } from '../fetch'
import { SALESFORCE } from '../constants'

export const CUSTOM_FEED_FILTER_METADATA_TYPE = 'CustomFeedFilter'
export const CUSTOM_FEED_FILTER_METADATA_TYPE_ID = new ElemID(
  SALESFORCE, CUSTOM_FEED_FILTER_METADATA_TYPE
)

const filterCreator: FilterCreator = ({ client, config }) => ({
  onFetch: async (elements: Element[]): Promise<ConfigChangeSuggestion[]> => {
    const customFeedFilterType = findObjectType(
      elements, CUSTOM_FEED_FILTER_METADATA_TYPE_ID
    )
    if (customFeedFilterType === undefined) {
      return []
    }
    // Fetch list of all custom feed filters
    const {
      elements: customFeedFilterList, configChanges: listObjectsConfigChanges,
    } = await listMetadataObjects(client, CUSTOM_FEED_FILTER_METADATA_TYPE, [])
    const instances = await fetchMetadataInstances({
      client,
      instancesNames: customFeedFilterList.map(e => `Case.${e.fullName}`),
      metadataType: customFeedFilterType,
      instancesRegexSkippedList: config.instancesRegexSkippedList,
    })
    instances.elements.forEach(e => elements.push(e))
    return [...instances.configChanges, ...listObjectsConfigChanges]
  },
})

export default filterCreator
