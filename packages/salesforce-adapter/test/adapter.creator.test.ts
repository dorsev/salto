import { InstanceElement, ElemID } from 'adapter-api'
import { creator } from '../src/adapter'
import SalesforceClient, { validateCredentials } from '../src/client/client'

jest.mock('../src/client/client')

describe('SalesforceAdapter creator', () => {
  describe('when validateConfig is called', () => {
    const config = new InstanceElement(
      ElemID.CONFIG_NAME,
      creator.configType,
      {
        username: 'myUser',
        password: 'myPassword',
        token: 'myToken',
        sandbox: false,
      }
    )

    beforeEach(() => {
      creator.validateConfig(config)
    })

    it('should call validateCredentials with the correct credentials', () => {
      const credentials = {
        username: 'myUser',
        password: 'myPassword',
        apiToken: 'myToken',
        isSandbox: false,
      }
      expect(validateCredentials).toHaveBeenCalledWith(credentials)
    })
  })
  describe('when passed a config element', () => {
    const config = new InstanceElement(
      ElemID.CONFIG_NAME,
      creator.configType,
      {
        username: 'myUser',
        password: 'myPassword',
        token: 'myToken',
        sandbox: false,
      }
    )

    beforeEach(() => {
      creator.create({ config })
    })

    it('creates the client correctly', () => {
      expect(SalesforceClient).toHaveBeenCalledWith({
        credentials: {
          username: 'myUser',
          password: 'myPassword',
          apiToken: 'myToken',
          isSandbox: false,
        },
      })
    })
  })
})
