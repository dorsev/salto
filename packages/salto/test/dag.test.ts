import _ from 'lodash'
import wu from 'wu'
import { CircularDependencyError, DependencyGraph } from '../src/dag'

class MaxCounter {
  private current: number = 0
  private max: number = 0

  increment(): void {
    this.current += 1
    if (this.current > this.max) {
      this.max = this.current
    }
  }

  decrement(): void {
    this.current -= 1
  }

  get maximum(): number {
    return this.max
  }
}

describe('DependencyGraph', () => {
  let graph: DependencyGraph<string>
  beforeEach(() => {
    graph = new DependencyGraph<string>()
  })

  describe('addNode', () => {
    describe('when adding nodes that do not exist', () => {
      beforeEach(() => graph.addNode('n1', 'n2', 'n3'))
      it('should add them', () => {
        expect(graph.edges()).toEqual([['n1', 'n2'], ['n1', 'n3']])
      })
    })

    describe('when adding a node without deps', () => {
      beforeEach(() => graph.addNode('n1'))
      it('should not create an edge', () => {
        expect(graph.edges().length).toEqual(0)
      })
    })
  })

  describe('getDependencies', () => {
    describe('when a node exists and has successors', () => {
      beforeEach(() => {
        graph.addNode('n1', 'n2', 'n3')
      })

      it('should return them', () => {
        expect(graph.getDependencies('n1')).toEqual(['n2', 'n3'])
      })
    })

    describe('when a node exists and has no successors', () => {
      beforeEach(() => {
        graph.addNode('n1', 'n2')
      })

      it('should return an empty iterator', () => {
        expect(graph.getDependencies('n2')).toEqual([])
      })
    })

    describe('when a node does not exist', () => {
      beforeEach(() => {
        graph.addNode('n1', 'n2')
      })

      it('should return an empty iterator', () => {
        expect(graph.getDependencies('n3')).toEqual([])
      })

      it('should not add it to the graph', () => {
        expect(graph.edges()).toEqual([['n1', 'n2']])
      })
    })
  })

  describe('evaluationOrderGroups', () => {
    let res: string[][]
    const getResult = (): void => {
      res = [...wu(graph.evaluationOrderGroups()).map(g => [...g])]
    }

    describe('for a simple graph', () => {
      beforeEach(() => {
        graph.addNode('n2', 'n1')
        graph.addNode('n3', 'n2')
        graph.addNode('n4', 'n2')
        getResult()
      })

      it('should return the nodes in the correct order', () => {
        expect(res).toEqual([['n1'], ['n2'], ['n3', 'n4']])
      })
    })

    describe('for an empty graph', () => {
      beforeEach(getResult)

      it('should return an empty array', () => {
        expect(res).toEqual([])
      })
    })
  })

  describe('evaluationOrder', () => {
    let res: string[]
    const getResult = (): void => {
      res = [...wu(graph.evaluationOrder())]
    }

    describe('for a simple graph', () => {
      beforeEach(() => {
        graph.addNode('n2', 'n1')
        graph.addNode('n3', 'n2')
        graph.addNode('n4', 'n2')
        getResult()
      })

      it('should return the nodes in the correct order', () => {
        expect(res).toEqual(['n1', 'n2', 'n3', 'n4'])
      })
    })

    describe('for an empty graph', () => {
      beforeEach(getResult)

      it('should return an empty array', () => {
        expect(res).toEqual([])
      })
    })
  })

  describe('removeRedundantEdges', () => {
    beforeEach(() => {
      graph.addNode('n2', 'n1')
      graph.addNode('n3', 'n2')
      graph.addNode('n4', 'n2')
      graph.addNode('n3', 'n1')
      expect(graph.edges().length).toEqual(4)
      graph.removeRedundantEdges()
    })

    it('should remove the redundant edge', () => {
      expect(graph.edges().length).toBe(3)
      expect(graph.edges()).toEqual([['n2', 'n1'], ['n3', 'n2'], ['n4', 'n2']])
    })

    describe('when there is a circular dependency', () => {
      beforeEach(() => {
        graph.addNode('n1', 'n4')
      })

      it('throws an exception', () => {
        expect(() => graph.removeRedundantEdges()).toThrow(
          CircularDependencyError
        )
      })
    })
  })

  describe('walkSync', () => {
    let handler: jest.Mock<void>

    beforeEach(() => {
      const handled = new Set<string>()
      handler = jest.fn((node: string) => {
        handled.add(node)
        expect(wu(graph.getDependencies(node)).every(n => handled.has(n))).toBeTruthy()
      })

      graph.addNode('n2', 'n1')
      graph.addNode('n3', 'n2')
      graph.addNode('n4', 'n2')
    })

    describe('for a simple graph', () => {
      beforeEach(() => graph.walkSync(handler))

      it('should call the handler in the correct order', () => {
        expect(_.flatten(handler.mock.calls)).toEqual(['n1', 'n2', 'n3', 'n4'])
      })
    })

    describe('for a graph with a circular dependency', () => {
      beforeEach(() => {
        graph.addNode('n1', 'n4')
      })

      it(
        'should throw CircularDependencyError',
        () => expect(() => graph.walkSync(handler)).toThrow(CircularDependencyError)
      )
    })
  })

  describe('walk', () => {
    let handler: jest.Mock<Promise<void>>
    let result: Promise<void>
    let concurrencyCounter: MaxCounter

    // simulates an async operation in zero time
    const dummyAsyncOperation = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

    beforeEach(() => {
      concurrencyCounter = new MaxCounter()
      const handled = new Set<string>()

      handler = jest.fn(async node => {
        concurrencyCounter.increment()
        expect(handled).not.toContain(node)
        expect(wu(graph.getDependencies(node)).every(n => handled.has(n))).toBeTruthy()
        await dummyAsyncOperation()
        handled.add(node)
        concurrencyCounter.decrement()
      })

      graph.addNode('n2', 'n1')
      graph.addNode('n3', 'n2')
      graph.addNode('n4', 'n2')
      graph.addNode('n5', 'n1')
    })

    describe('for a simple graph', () => {
      beforeEach(() => {
        result = graph.walk(handler)
        return result
      })

      it('should resolve the promise', () => {
        expect(result).resolves.toBeUndefined()
      })

      it('should call the handler in the correct order', () => {
        expect(_.flatten(handler.mock.calls)).toEqual(['n1', 'n2', 'n5', 'n3', 'n4'])
      })

      it('should call the handler as concurrently as possible', () => {
        expect(concurrencyCounter.maximum).toBe(3)
      })
    })

    describe('for a graph with a circular dependency', () => {
      beforeEach(() => {
        graph.addNode('n1', 'n4')
        result = graph.walk(handler)
      })

      it(
        'should reject with CircularDependencyError',
        () => expect(result).rejects.toBeInstanceOf(CircularDependencyError)
      )
    })
  })
})