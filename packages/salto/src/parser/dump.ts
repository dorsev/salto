import _ from 'lodash'
import {
  Type, Field, Values, isObjectType, PrimitiveTypes,
  isPrimitiveType, Element, isInstanceElement, isField, isElement,
} from 'adapter-api'
import HclParser, { DumpedHclBlock, HclDumpReturn } from './hcl'
import { Keywords } from './language'

/**
 * @param primitiveType Primitive type identifier
 * @returns Type name in HCL syntax
 */
const getPrimitiveTypeName = (primitiveType: PrimitiveTypes): string => {
  if (primitiveType === PrimitiveTypes.STRING) {
    return Keywords.TYPE_STRING
  }
  if (primitiveType === PrimitiveTypes.NUMBER) {
    return Keywords.TYPE_NUMBER
  }
  if (primitiveType === PrimitiveTypes.BOOLEAN) {
    return Keywords.TYPE_BOOL
  }
  return Keywords.TYPE_OBJECT
}

const QUOTE_MARKER = 'Q_MARKER'

const markQuote = (value: string): string => `${QUOTE_MARKER}${value}${QUOTE_MARKER}`

const markDumpedBlockQuotes = (block: DumpedHclBlock): DumpedHclBlock => {
  block.labels = block.labels.map(markQuote)
  block.blocks = block.blocks.map(markDumpedBlockQuotes)
  return block
}

const removeQuotes = (
  value: HclDumpReturn
): HclDumpReturn => value.replace(new RegExp(`"${QUOTE_MARKER}|${QUOTE_MARKER}"`, 'g'), '')

const dumpFieldBlock = (field: Field): DumpedHclBlock => ({
  type: field.type.elemID.getFullName(),
  labels: [field.name],
  attrs: field.annotations,
  blocks: [],
})

const dumpListFieldBlock = (field: Field): DumpedHclBlock => ({
  type: Keywords.LIST_DEFINITION,
  labels: [field.type.elemID.getFullName(), field.name],
  attrs: field.annotations,
  blocks: [],
})

const dumpAnnotationsBlock = (element: Type): DumpedHclBlock[] =>
  (_.isEmpty(element.annotationTypes) ? [] : [{
    type: Keywords.ANNOTATIONS_DEFINITION,
    labels: [],
    attrs: {},
    blocks: Object.entries(element.annotationTypes).map(([key, type]) => ({
      type: type.elemID.getFullName(),
      labels: [key],
      attrs: {},
      blocks: [],
    })),
  }])

let dumpBlock: (value: Element | Values) => DumpedHclBlock

const dumpElementBlock = (elem: Element): DumpedHclBlock => {
  if (isObjectType(elem)) {
    return {
      type: elem.isSettings ? Keywords.SETTINGS_DEFINITION : Keywords.TYPE_DEFINITION,
      labels: [elem.elemID.getFullName()],
      attrs: elem.annotations,
      blocks: dumpAnnotationsBlock(elem).concat(
        Object.values(elem.fields).map(dumpBlock)
      ),
    }
  }
  if (isPrimitiveType(elem)) {
    return {
      type: Keywords.TYPE_DEFINITION,
      labels: [
        elem.elemID.getFullName(),
        Keywords.TYPE_INHERITANCE_SEPARATOR,
        getPrimitiveTypeName(elem.primitive),
      ],
      attrs: elem.annotations,
      blocks: dumpAnnotationsBlock(elem),
    }
  }
  if (isInstanceElement(elem)) {
    return {
      type: elem.type.elemID.getFullName(),
      labels: elem.elemID.isConfig() ? [] : [elem.elemID.name],
      attrs: elem.value,
      blocks: [],
    }
  }
  // Without this exception the linter won't allow us to end the function
  // without a return value
  throw new Error('Unsupported element type')
}

dumpBlock = (value: Element | Values): DumpedHclBlock => {
  if (isField(value)) {
    return value.isList ? dumpListFieldBlock(value) : dumpFieldBlock(value)
  }
  if (isElement(value)) {
    return dumpElementBlock(value)
  }
  // If we reach this point we are serializing values
  return {
    type: '',
    labels: [],
    attrs: value as Values,
    blocks: [],
  }
}

const wrapBlocks = (blocks: DumpedHclBlock[]): DumpedHclBlock => ({
  type: '',
  labels: [],
  attrs: {},
  blocks,
})

export const dump = async (elementsOrValues: Element | Element[] | Values): Promise<string> => {
  // If we got a single element, put it in an array because we need to wrap it with an empty block
  const elemListOrValues = isElement(elementsOrValues) ? [elementsOrValues] : elementsOrValues

  const body = _.isArray(elemListOrValues)
    ? wrapBlocks(elemListOrValues.map(dumpBlock))
    : dumpBlock(elemListOrValues)

  body.blocks = body.blocks.map(markDumpedBlockQuotes)
  return removeQuotes(await HclParser.dump(body))
}