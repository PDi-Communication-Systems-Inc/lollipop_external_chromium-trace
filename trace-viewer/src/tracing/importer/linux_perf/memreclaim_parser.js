// Copyright (c) 2012 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

'use strict';

/**
 * @fileoverview Parses vmscan events in the Linux event trace format.
 */
base.require('tracing.importer.linux_perf.parser');
base.exportTo('tracing.importer.linux_perf', function() {

  var Parser = tracing.importer.linux_perf.Parser;

  /**
   * Parses linux vmscan trace events.
   * @constructor
   */
  function MemReclaimParser(importer) {
    Parser.call(this, importer);

    importer.registerEventHandler('mm_vmscan_kswapd_wake',
        MemReclaimParser.prototype.kswapdWake.bind(this));
    importer.registerEventHandler('mm_vmscan_kswapd_sleep',
        MemReclaimParser.prototype.kswapdSleep.bind(this));
    importer.registerEventHandler('mm_vmscan_direct_reclaim_begin',
        MemReclaimParser.prototype.reclaimBegin.bind(this));
    importer.registerEventHandler('mm_vmscan_direct_reclaim_end',
        MemReclaimParser.prototype.reclaimEnd.bind(this));
  }

  // Matches the mm_vmscan_kswapd_wake record
  //  mm_vmscan_kswapd_wake: nid=%d order=%d
  var kswapdWakeRE = /nid=(\d+) order=(\d+)/;

  // Matches the mm_vmscan_kswapd_sleep record
  //  mm_vmscan_kswapd_sleep: order=%d
  var kswapdSleepRE = /nid=(\d+)/;

  // Matches the mm_vmscan_direct_reclaim_begin record
  //  mm_vmscan_direct_reclaim_begin: order=%d may_writepage=%d gfp_flags=%s
  var reclaimBeginRE = /order=(\d+) may_writepage=\d+ gfp_flags=(.+)/;

  // Matches the mm_vmscan_direct_reclaim_end record
  //  mm_vmscan_direct_reclaim_end: nr_reclaimed=%lu
  var reclaimEndRE = /nr_reclaimed=(\d+)/;

  MemReclaimParser.prototype = {
    __proto__: Parser.prototype,

    openAsyncSlice: function(ts, category, threadName, pid, key, name) {
      var kthread = this.importer.getOrCreateKernelThread(
          category + ':' + threadName, pid);
      var slice = new tracing.trace_model.AsyncSlice(
          category, name, tracing.getStringColorId(name), ts);
      slice.startThread = kthread.thread;

      if (!kthread.openAsyncSlices) {
        kthread.openAsyncSlices = { };
      }
      kthread.openAsyncSlices[key] = slice;
    },

    closeAsyncSlice: function(ts, category, threadName, pid, key, args) {
      var kthread = this.importer.getOrCreateKernelThread(
          category + ':' + threadName, pid);
      if (kthread.openAsyncSlices) {
        var slice = kthread.openAsyncSlices[key];
        if (slice) {
          slice.duration = ts - slice.start;
          slice.args = args;
          slice.endThread = kthread.thread;
          slice.subSlices = [
            new tracing.trace_model.Slice(category, slice.title,
                slice.colorId, slice.start, slice.args, slice.duration)
          ];
          kthread.thread.asyncSliceGroup.push(slice);
          delete kthread.openAsyncSlices[key];
        }
      }
    },

    /**
     * Parses memreclaim events and sets up state in the importer.
     */
    kswapdWake: function(eventName, cpuNumber, pid, ts, eventBase) {
      var event = kswapdWakeRE.exec(eventBase.details);
      if (!event)
        return false;

      var nid = parseInt(event[1])
      var order = parseInt(event[2])

      var kthread = this.importer.getOrCreateKernelThread("kswapd: " + eventBase.threadName,
          pid, pid);
      if (kthread.openSliceTS) {
        if (order > kthread.order) {
          kthread.order = order;
        }
      } else {
        kthread.openSliceTS = ts;
        kthread.order = order;
      }
      return true;
    },

    kswapdSleep: function(eventName, cpuNumber, pid, ts, eventBase) {
      var kthread = this.importer.getOrCreateKernelThread("kswapd: " + eventBase.threadName,
          pid, pid);
      if (kthread.openSliceTS) {
        var slice = new tracing.trace_model.Slice('', eventBase.threadName,
            tracing.getStringColorId(eventBase.threadName),
            kthread.openSliceTS,
            {
                order: kthread.order,
            },
            ts - kthread.openSliceTS);

        kthread.thread.sliceGroup.pushSlice(slice);
      }
      kthread.openSliceTS = undefined;
      kthread.order = undefined;
      return true;
    },

    reclaimBegin: function(eventName, cpuNumber, pid, ts, eventBase) {
      var event = reclaimBeginRE.exec(eventBase.details);
      if (!event)
        return false;
      
      var order = parseInt(event[1]);
      var gfp = event[2]

      var kthread = this.importer.getOrCreateKernelThread("direct reclaim: " + eventBase.threadName,
          pid, pid);
      kthread.openSliceTS = ts;
      kthread.order = order;
      kthread.gfp = gfp;
      return true;
    },

    reclaimEnd: function(eventName, cpuNumber, pid, ts, eventBase) {
      var event = reclaimEndRE.exec(eventBase.details);
      if (!event)
        return false;
      
      var nr_reclaimed = parseInt(event[1]);

      var kthread = this.importer.getOrCreateKernelThread("direct reclaim: " + eventBase.threadName,
          pid, pid);
      if (kthread.openSliceTS !== undefined) {
        var slice = new tracing.trace_model.Slice(
            "", "direct reclaim",
            tracing.getStringColorId(eventBase.threadName),
            kthread.openSliceTS,
            { 
                order: kthread.order,
                gfp: kthread.gfp,
                nr_reclaimed: nr_reclaimed,
            },
            ts - kthread.openSliceTS);
        kthread.thread.sliceGroup.pushSlice(slice);
      }
      kthread.openSliceTS = undefined;
      kthread.order = undefined;
      kthread.gfp = undefined;
      return true;
    }

  };

  Parser.registerSubtype(MemReclaimParser);

  return {
    MemReclaimParser: MemReclaimParser
  };
});
